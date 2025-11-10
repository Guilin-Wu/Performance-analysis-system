/* eslint-disable no-undef */ // 告诉编辑器 ECharts 和 XLSX 是全局变量

'use strict';

// ---------------------------------
// 1. 全局配置与状态
// ---------------------------------
// 默认科目列表，仅用于程序首次加载
const DEFAULT_SUBJECT_LIST = ['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理'];
// [!!] 关键：G_DynamicSubjectList 现在是唯一的科目来源，默认等于 DEFAULT_SUBJECT_LIST
let G_DynamicSubjectList = [...DEFAULT_SUBJECT_LIST];

// 存储数据
let G_StudentsData = []; // { id, name, class, totalScore, rank, gradeRank, scores: {...} }
let G_CompareData = [];  // 同上, 用于对比
//let G_MultiExamData = [];
let G_Statistics = {};   // 存储当前 *已筛选* 后的统计数据
let G_CompareStatistics = {};
let G_TrendSort = { key: 'rank', direction: 'asc' }; // [!!] (新增) 趋势模块的排序状态

// 存储UI状态
let G_CurrentClassFilter = 'ALL';
let G_CurrentImportType = 'main';
let G_SubjectConfigs = {};

// ---------------------------------
// 2. DOM 元素
// ---------------------------------
let fileUploader, fileUploaderCompare, navLinks, modulePanels, welcomeScreen, compareUploadLabel;
let classFilterContainer, classFilterSelect, classFilterHr;
let modal, modalCloseBtn, modalSaveBtn, configSubjectsBtn, subjectConfigTableBody;
let echartsInstances = {};

document.addEventListener('DOMContentLoaded', () => {
    // 绑定 DOM 元素
    fileUploader = document.getElementById('file-uploader');
    fileUploaderCompare = document.getElementById('file-uploader-compare');
    navLinks = document.querySelectorAll('.nav-link');
    modulePanels = document.querySelectorAll('.module-panel');
    welcomeScreen = document.getElementById('welcome-screen');

    // 班级筛选
    classFilterContainer = document.getElementById('class-filter-container');
    classFilterSelect = document.getElementById('class-filter');
    classFilterHr = document.getElementById('class-filter-hr');

    // 科目配置
    modal = document.getElementById('subject-config-modal');
    modalCloseBtn = document.getElementById('modal-close-btn');
    modalSaveBtn = document.getElementById('modal-save-btn');
    configSubjectsBtn = document.getElementById('config-subjects-btn');
    subjectConfigTableBody = document.getElementById('subject-config-table').getElementsByTagName('tbody')[0];

    // [!!] (新增) 导入模态框 DOM
    const importModal = document.getElementById('import-modal');
    const importModalTitle = document.getElementById('import-modal-title');
    const importModalCloseBtn = document.getElementById('import-modal-close-btn');
    const importModalSelect = document.getElementById('import-modal-select');
    const importModalFromFileBtn = document.getElementById('import-modal-from-file');
    const importModalFromStorageBtn = document.getElementById('import-modal-from-storage');
    const importMainBtn = document.getElementById('import-main-btn'); // (新按钮)
    const importCompareBtn = document.getElementById('import-compare-btn'); // (新按钮)
    const clearAllBtn = document.getElementById('clear-all-data-btn'); // [!!] (新增)

    // 初始化 UI
    initializeUI();
    initializeSubjectConfigs(); // 初始化科目配置
    loadDataFromStorage();

    // ---------------------------------
    // 3. 事件监听器
    // ---------------------------------

    // 监听文件上传 (本次成绩) - [!!] (不变) 由模态框触发
    fileUploader.addEventListener('change', async (event) => {
        await handleFileData(event, 'main');
    });

    // 监听文件上传 (对比成绩) - [!!] (不变) 由模态框触发
    fileUploaderCompare.addEventListener('change', async (event) => {
        await handleFileData(event, 'compare');
    });

    // [!!] (新增) 打开导入模态框 (主)
    importMainBtn.addEventListener('click', () => {
        G_CurrentImportType = 'main';
        importModalTitle.innerText = '选择“本次成绩”数据源';
        openImportModal();
    });

    // [!!] (新增) 打开导入模态框 (对比)
    importCompareBtn.addEventListener('click', (e) => {
        if (e.target.classList.contains('disabled')) return;
        G_CurrentImportType = 'compare';
        importModalTitle.innerText = '选择“对比成绩”数据源';
        openImportModal();
    });

    // [!!] (新增) 导入模态框：关闭
    importModalCloseBtn.addEventListener('click', () => {
        importModal.style.display = 'none';
    });

    // [!!] (新增) 导入模态框：从文件
    importModalFromFileBtn.addEventListener('click', () => {
        if (G_CurrentImportType === 'main') {
            fileUploader.click();
        } else {
            fileUploaderCompare.click();
        }
        importModal.style.display = 'none';
    });

    // [!!] (新增) 导入模态框：从存储
    importModalFromStorageBtn.addEventListener('click', () => {
        const selectedId = importModalSelect.value;
        if (!selectedId) {
            alert('请选择一个已存的成绩单！');
            return;
        }

        const allData = loadMultiExamData();
        const selectedExam = allData.find(e => String(e.id) === selectedId);
        if (!selectedExam) {
            alert('未找到所选数据，请刷新重试。');
            return;
        }

        // (复用 handleFileData 的核心逻辑)
        const labelText = `✅ ${selectedExam.label} (来自存储)`;

        if (G_CurrentImportType === 'main') {
            G_StudentsData = selectedExam.students;
            localStorage.setItem('G_StudentsData', JSON.stringify(G_StudentsData));
            localStorage.setItem('G_MainFileName', selectedExam.label);

            populateClassFilter(G_StudentsData);
            // 解锁 UI
            welcomeScreen.style.display = 'none';
            document.getElementById('import-compare-btn').classList.remove('disabled');
            navLinks.forEach(l => l.classList.remove('disabled'));
            classFilterContainer.style.display = 'block';
            classFilterHr.style.display = 'block';

            if (importMainBtn) importMainBtn.innerHTML = labelText;

        } else { // 'compare'
            G_CompareData = selectedExam.students;
            localStorage.setItem('G_CompareData', JSON.stringify(G_CompareData));
            localStorage.setItem('G_CompareFileName', selectedExam.label);

            const compareBtn = document.getElementById('import-compare-btn');
            if (compareBtn) compareBtn.innerHTML = labelText;
        }

        runAnalysisAndRender();
        importModal.style.display = 'none';
    });

    // [!!] (新增) 监听“清除所有数据”按钮

    clearAllBtn.addEventListener('click', () => {
        if (confirm("您确定要清除所有已导入的“本次成绩”和“对比成绩”吗？\n\n(此操作不会清除“模块十二”中保存的数据)")) {
            // 1. 清除 localStorage
            localStorage.removeItem('G_StudentsData');
            localStorage.removeItem('G_CompareData');
            localStorage.removeItem('G_MainFileName');
            localStorage.removeItem('G_CompareFileName');
            localStorage.removeItem('G_SubjectConfigs');

            // 2. 刷新页面
            location.reload();
        }
    });


    // 监听导航切换
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();

            // [!!] (修改) 先获取模块名
            const targetModule = link.getAttribute('data-module');

            // [!!] (修改) 如果不是“多次考试分析”模块，才检查 disabled
            if (targetModule !== 'multi-exam' && link.classList.contains('disabled')) {
                alert('请先导入本次成绩数据！');
                return;
            }
            // const targetModule = link.getAttribute('data-module'); // (已移到前面)

            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');

            runAnalysisAndRender();
        });
    });

    // 班级筛选
    classFilterSelect.addEventListener('change', () => {
        G_CurrentClassFilter = classFilterSelect.value;
        runAnalysisAndRender();
    });

    // 科目配置模态窗
    configSubjectsBtn.addEventListener('click', () => {
        populateSubjectConfigModal();
        modal.style.display = 'flex';
    });
    modalCloseBtn.addEventListener('click', () => {
        modal.style.display = 'none';
    });
    modalSaveBtn.addEventListener('click', () => {
        saveSubjectConfigsFromModal();
        modal.style.display = 'none';
        runAnalysisAndRender();
    });

    // 监听窗口大小变化
    window.addEventListener('resize', () => {
        for (const key in echartsInstances) {
            if (echartsInstances[key]) {
                echartsInstances[key].resize();
            }
        }
    });
});

/**
 * 4. UI 初始化
 * 禁用所有操作，直到主文件被加载
 */
function initializeUI() {
    document.getElementById('import-compare-btn').classList.add('disabled');
    navLinks.forEach(link => {
        // [!!] (修改) 允许“多次考试分析”模块始终可用
        const module = link.getAttribute('data-module');
        if (module === 'multi-exam') {
            link.classList.remove('disabled'); // 确保它绝不被禁用
        } else if (!link.classList.contains('active')) {
            link.classList.add('disabled');
        }
    });
}

/**
 * 5. 核心功能：文件处理
 * @param {Event} event - 文件上传事件
 * @param {'main' | 'compare'} type - 加载的数据类型
 */
async function handleFileData(event, type) {
    const file = event.target.files[0];
    if (!file) return;

    const label = (type === 'main') ? fileUploader.previousElementSibling : document.getElementById('import-compare-btn');
    label.innerHTML = "🔄 正在解析...";

    try {
        // 1. [!!] 接收解析器返回的两个值
        const { processedData, dynamicSubjectList } = await loadExcelData(file);

        if (type === 'main') {
            // 2. [!!] 如果是主文件, 更新全局科目列表和配置
            // (这必须在 'addSubjectRanksToData' 之前完成)
            G_DynamicSubjectList = dynamicSubjectList;
            initializeSubjectConfigs();
        }

        // 3. [!!] (移出) 在 IF/ELSE 外部计算排名
        // 这样 'rankedData' 在后续两个分支中都可用
        const rankedData = addSubjectRanksToData(processedData);

        // 4. [!!] (重构) 根据类型分配数据
        if (type === 'main') {
            G_StudentsData = rankedData;
            localStorage.setItem('G_StudentsData', JSON.stringify(G_StudentsData));
            localStorage.setItem('G_MainFileName', file.name);
            // 填充班级筛选
            populateClassFilter(G_StudentsData);

            // 解锁 UI
            welcomeScreen.style.display = 'none';
            document.getElementById('import-compare-btn').classList.remove('disabled');
            navLinks.forEach(l => l.classList.remove('disabled'));
            classFilterContainer.style.display = 'block';
            classFilterHr.style.display = 'block';

            // 运行分析
            runAnalysisAndRender();
        } else {
            // (现在 'rankedData' 在此作用域中可用)
            G_CompareData = rankedData;
            localStorage.setItem('G_CompareData', JSON.stringify(G_CompareData));
            localStorage.setItem('G_CompareFileName', file.name);
        }

        label.innerHTML = `✅ ${file.name} (已加载)`;

    } catch (err) {
        console.error(err);
        label.innerHTML = `❌ 加载失败 (点击重试)`;
        alert(`数据加载失败：\n${err.message}`);
        event.target.value = null;
    }
}


/**
 * 6.1 读取 Excel/CSV 文件 (智能解析器 - 动态识别表头行和科目)
 * [!!] (重构) 
 * - 1. 表头定位器不再强制要求 "得分"，只查找 "姓名" 和 "班级"。
 * - 2. 列映射器现在支持 "一级表头" (例如, "语文" 列直接代表分数)。
 *
 * @param {File} file - 用户上传的Excel或CSV文件对象。
 * @returns {Promise<Object>} - 包含 { processedData, dynamicSubjectList } 的对象。
 */
function loadExcelData(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                // 1. 读取工作簿
                const workbook = XLSX.read(data, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];

                const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });

                if (rawData.length < 2) { // (修改) 至少需要1行表头和1行数据
                    return reject(new Error("文件数据不完整，至少需要1行表头和1行数据。"));
                }

                // --- 🚀 智能定位表头行 (重构) ---
                let keyRowIndex = -1;
                // [!!] (修改) 我们只依赖 "姓名" 和 "班级"
                const REQUIRED_METRICS = ["姓名", "班级"];

                // 遍历原始数据的前几行（最多前5行）
                for (let i = 0; i < Math.min(rawData.length, 5); i++) {
                    const row = rawData[i].map(String).map(s => s.trim());
                    const foundCount = REQUIRED_METRICS.filter(metric => row.includes(metric)).length;

                    // [!!] (修改) 只要 "姓名" 和 "班级" 都在，就认定是关键行
                    if (foundCount === 2) {
                        keyRowIndex = i;
                        break;
                    }
                }

                if (keyRowIndex === -1) {
                    // [!!] (修改) 更新错误提示
                    return reject(new Error("无法自动识别指标行。请确保表头包含 '姓名' 和 '班级' 字段。"));
                }

                // 确定科目行（关键行的上一行）和数据开始行
                const subjectRowIndex = keyRowIndex - 1;
                const studentDataStartRow = keyRowIndex + 1;

                // 科目行：可能存在（两级表头）或不存在（一级表头或大标题）
                const subjectHeader = (subjectRowIndex >= 0) ?
                    rawData[subjectRowIndex].map(String).map(s => s.trim()) :
                    [];
                // 关键行
                const keyHeader = rawData[keyRowIndex].map(String).map(s => s.trim());
                // --- 🚀 智能定位表头行 END ---


                const colMap = {};
                let currentSubject = ""; // (用于两级表头)
                const headerLength = keyHeader.length;
                const dynamicSubjectList = [];

                // [!!] (重构) 2. 核心：动态构建列映射 (colMap)
                for (let i = 0; i < headerLength; i++) {
                    const subject = String(subjectHeader[i] || "").trim(); // 科目行
                    const key = keyHeader[i]; // 关键行

                    // A. 识别固定字段 (基于 关键行 key)
                    if (key === "自定义考号") { colMap[i] = "id"; continue; }
                    if (key === "姓名") { colMap[i] = "name"; continue; }
                    if (key === "班级") { colMap[i] = "class"; continue; }
                    if (key === "班次") { colMap[i] = "rank"; continue; }
                    if (key === "校次") { colMap[i] = "gradeRank"; continue; }

                    // B. 追踪科目名 (基于 科目行 subject)
                    if (subject !== "") {
                        currentSubject = subject;
                    }

                    // C. 识别总分
                    // (Case 1: 两级表头 - subject="总分", key="得分")
                    if (currentSubject === "总分" && key === "得分") {
                        colMap[i] = "totalScore";
                    }
                    // (Case 2: 一级表头 - key="总分")
                    else if (key === "总分") {
                        colMap[i] = "totalScore";
                    }

                    // D. 识别各科得分
                    // (Case 1: 两级表头 - subject="语文", key="得分")
                    else if (key === "得分" && currentSubject !== "" && currentSubject !== "总分") {
                        colMap[i] = `scores.${currentSubject}`;
                        if (!dynamicSubjectList.includes(currentSubject)) {
                            dynamicSubjectList.push(currentSubject);
                        }
                    }
                    // (Case 2: 一级表头 - key="语文")
                    // (我们排除所有已知的非科目关键字)
                    else if (key !== "" &&
                             !["自定义考号", "姓名", "班级", "班次", "校次", "得分", "准考证号", "学生属性"].includes(key) && // [!!] (修改) 在这里添加 "准考证号"
                             !key.includes("总分")) {
                        // (此时 subjectHeader 可能是空的, key 是 "语文")
                        const subjectName = key;
                        colMap[i] = `scores.${subjectName}`;
                        if (!dynamicSubjectList.includes(subjectName)) {
                            dynamicSubjectList.push(subjectName);
                        }
                    }
                }

                // 3. 校验关键字段
                // [!!] (修改) 只要求 "name" 和 "class"
                const requiredKeys = ["name", "class"];
                const foundKeys = Object.values(colMap);
                const missingKeys = requiredKeys.filter(key => !foundKeys.includes(key));

                if (missingKeys.length > 0) {
                    // [!!] (修改) 更新错误提示
                    return reject(new Error(`无法自动解析表头。文件缺少关键字段: ${missingKeys.join(', ')}。请确保表头包含 '姓名' 和 '班级'。`));
                }

                // 4. 处理数据行
                const studentRows = rawData.slice(studentDataStartRow);
                const processedData = [];

                for (const row of studentRows) {
                    if (!String(row[Object.keys(colMap)[0]] || "").trim() && !String(row[Object.keys(colMap)[1]] || "").trim()) continue;

                    const student = { scores: {} };

                    for (const colIndex in colMap) {
                        const key = colMap[colIndex];
                        const rawValue = row[colIndex];

                        if (key.startsWith("scores.")) {
                            const subjectName = key.split('.')[1];
                            const cleanScore = parseFloat(rawValue);
                            student.scores[subjectName] = isNaN(cleanScore) ? null : cleanScore;
                        } else if (key === "totalScore") {
                            const cleanTotal = parseFloat(rawValue);
                            student.totalScore = isNaN(cleanTotal) ? null : cleanTotal;
                        } else if (key === "rank" || key === "gradeRank") {
                            const cleanRank = parseInt(rawValue);
                            // [!!] (修改) 缺失的排名设为 null, 以便触发自动计算
                            student[key] = isNaN(cleanRank) ? null : cleanRank;
                        } else {
                            student[key] = String(rawValue || "").trim();
                        }
                    }

// [!!] (修改) 自动计算总分 (始终覆盖)
                // if (student.totalScore === undefined || student.totalScore === null) { // <-- 删除这一行
                    let calculatedTotal = 0;
                    let hasValidScores = false;

                    for (const subject of dynamicSubjectList) {
                        const score = student.scores[subject];
                        if (typeof score === 'number' && !isNaN(score)) {
                            calculatedTotal += score;
                            hasValidScores = true;
                        }
                    }
                    student.totalScore = hasValidScores ? parseFloat(calculatedTotal.toFixed(2)) : null;
                // } // <-- 删除这一行

                    // [!!] (新增) ID回退
                    if (!student.id && student.name) {
                        student.id = student.name;
                    }

                    if (student.id) {
                        processedData.push(student);
                    }
                }

                if (processedData.length === 0) {
                    return reject(new Error("文件解析成功，但没有找到有效的学生数据行。"));
                }

                resolve({ processedData: processedData, dynamicSubjectList: dynamicSubjectList });

            } catch (err) {
                console.error(err);
                reject(new Error("文件解析失败: ".concat(err.message || "未知错误。")));
            }
        };
        reader.onerror = (err) => reject(new Error("文件读取失败: ".concat(err)));
        reader.readAsArrayBuffer(file);
    });
}
/**
 * (重构) 6.2. 为数据添加单科排名
 * (总分排名 'rank' 和 'gradeRank' 已经从Excel读取)
 * @param {Array<Object>} studentsData
 * @returns {Array<Object>}
 */
function addSubjectRanksToData(studentsData) {
    const dataWithRanks = [...studentsData];
    const classes = [...new Set(dataWithRanks.map(s => s.class))]; // [!!] (新增) 获取所有班级

    // 1. 检查是否需要计算 年级总分排名 (gradeRank)
    // (如果第一个学生没有年排(是null或0), 假设所有学生都没有)
    if (!dataWithRanks[0].gradeRank) {
        // 按总分排序 (高到低)
        dataWithRanks.sort((a, b) => (b.totalScore || -Infinity) - (a.totalScore || -Infinity));
        // 赋予年级排名
        dataWithRanks.forEach((student, index) => {
            student.gradeRank = index + 1;
        });
    }

    // 2. 检查是否需要计算 班级总分排名 (rank)
    if (!dataWithRanks[0].rank) {
        classes.forEach(className => {
            // 筛选该班学生
            const classStudents = dataWithRanks.filter(s => s.class === className);
            // 按总分排序 (高到低)
            classStudents.sort((a, b) => (b.totalScore || -Infinity) - (a.totalScore || -Infinity));
            // 赋予班级排名
            classStudents.forEach((student, index) => {
                student.rank = index + 1;
            });
        });
    }

    G_DynamicSubjectList.forEach(subjectName => {

        // 1. [!!] (修改) 计算年级科目排名 (Grade Ranks)
        const sortedByGrade = [...dataWithRanks].sort((a, b) => {
            const scoreA = a.scores[subjectName] || -Infinity;
            const scoreB = b.scores[subjectName] || -Infinity;
            return scoreB - scoreA;
        });

        sortedByGrade.forEach((student, index) => {
            if (!student.gradeRanks) student.gradeRanks = {}; // [!!] (重命名)
            student.gradeRanks[subjectName] = index + 1;
        });

        // 2. [!!] (新增) 计算班级科目排名 (Class Ranks)
        classes.forEach(className => {
            // 筛选出该班学生
            const classStudents = dataWithRanks.filter(s => s.class === className);

            // 按分数排序
            const sortedByClass = [...classStudents].sort((a, b) => {
                const scoreA = a.scores[subjectName] || -Infinity;
                const scoreB = b.scores[subjectName] || -Infinity;
                return scoreB - scoreA;
            });

            // 附加班级排名
            sortedByClass.forEach((student, index) => {
                if (!student.classRanks) student.classRanks = {}; // [!!] (新属性)
                student.classRanks[subjectName] = index + 1;
            });
        });
    });

    // 按Excel中提供的 班级排名(rank) 排序后返回
    return dataWithRanks.sort((a, b) => a.rank - b.rank);
}


/**
 * (重构) 6.3. 计算所有统计数据
 * @param {Array<Object>} studentsData (这是 *已筛选* 后的数据)
 * @returns {Object}
 */
function calculateAllStatistics(studentsData) {
    if (!studentsData || studentsData.length === 0) return {};

    const stats = {};

    // 1. 统计所有科目 (从 G_SubjectConfigs 读取配置)
    // [!!] (新增) totalGood
    let totalFull = 0, totalPass = 0, totalExcel = 0, totalGood = 0;

    G_DynamicSubjectList.forEach(subjectName => {
        const config = G_SubjectConfigs[subjectName];
        if (!config) return; // 如果配置不存在，跳过

        const subjectScores = studentsData
            .map(s => s.scores[subjectName])
            .filter(score => typeof score === 'number' && !isNaN(score))
            .sort((a, b) => a - b);

        // [!!] (修改) 传入 config.good
        stats[subjectName] = calculateStatsForScores(subjectScores, config.full, config.pass, config.excel, config.good);
        stats[subjectName].name = subjectName;

        // 累加总分配置
        totalFull += config.full;
        totalPass += config.pass;
        totalExcel += config.excel;
        totalGood += config.good; // [!!] (新增)
    });

    // 2. 统计 '总分' (totalScore)
    const totalScores = studentsData.map(s => s.totalScore).filter(score => typeof score === 'number' && !isNaN(score)).sort((a, b) => a - b);
    // [!!] (修改) 传入 totalGood
    stats['totalScore'] = calculateStatsForScores(totalScores, totalFull, totalPass, totalExcel, totalGood);
    stats['totalScore'].name = '总分';

    return stats;
}

/**
 * (重构) 6.4. 辅助函数：计算单个分数数组的统计值
 * [!!] 已新增 "difficulty" 字段
 */
// [!!] (修改) 增加 goodLine 参数
function calculateStatsForScores(scores, fullMark, passLine, excellentLine, goodLine) {
    const count = scores.length;
    // [!!] (修改) 增加 goodRate 和 failRate
    if (count === 0) return { average: 0, max: 0, min: 0, median: 0, passRate: 0, excellentRate: 0, goodRate: 0, failRate: 0, count: 0, variance: 0, stdDev: 0, difficulty: 0, scores: [] };

    const total = scores.reduce((acc, score) => acc + score, 0);
    const average = total / count;
    const max = scores[count - 1];
    const min = scores[0];

    const mid = Math.floor(count / 2);
    const median = count % 2 === 0 ? (scores[mid - 1] + scores[mid]) / 2 : scores[mid];

    const variance = (count > 0) ? scores.reduce((acc, score) => acc + Math.pow(score - average, 2), 0) / count : 0;
    const stdDev = (count > 0) ? Math.sqrt(variance) : 0;

    const difficulty = (fullMark > 0) ? parseFloat((average / fullMark).toFixed(2)) : 0;

    const passCount = scores.filter(s => s >= passLine).length;
    const excellentCount = scores.filter(s => s >= excellentLine).length;

    // [!!] (新增) 良好率 (B) 和 不及格率 (D)
    // (B) - B (良好) = [goodLine, excelLine)
    const countB = scores.filter(s => s >= goodLine && s < excellentLine).length;
    // (D) - D (不及格) = < passLine
    const countD = scores.filter(s => s < passLine).length;

    // [!!] (新增) C级率 (C)
    // (C) - C (及格) = [passLine, goodLine)
    const countC = scores.filter(s => s >= passLine && s < goodLine).length;
    const cRate = (count > 0) ? (countC / count) * 100 : 0;

    // [!!] (新增) 良好率 (B级率)
    const goodRate = (count > 0) ? (countB / count) * 100 : 0;
    // [!!] (新增) 不及格率 (D级率)
    const failRate = (count > 0) ? (countD / count) * 100 : 0;

    return {
        count: count,
        average: parseFloat(average.toFixed(2)),
        max: max,
        min: min,
        median: median,
        passRate: parseFloat(((passCount / count) * 100).toFixed(2)),
        excellentRate: parseFloat(((excellentCount / count) * 100).toFixed(2)),
        // [!!] (新增)
        goodRate: parseFloat(goodRate.toFixed(2)),
        cRate: parseFloat(cRate.toFixed(2)), // [!!] (新增)
        failRate: parseFloat(failRate.toFixed(2)),
        variance: parseFloat(variance.toFixed(2)),
        stdDev: parseFloat(stdDev.toFixed(2)),
        difficulty: difficulty,
        scores: scores // 保留原始数组，用于直方图
    };
}

// ---------------------------------
// 7. 模块渲染 (Routing)
// ---------------------------------

/**
 * (新增) 7.1. 核心分析与渲染触发器
 * [!!] (已修改) 允许 multi-exam 模块在没有 G_StudentsData 时运行
 */
function runAnalysisAndRender() {
    // 1. [!!] (修改) 先获取当前要渲染的模块
    const currentModuleLink = document.querySelector('.nav-link.active');
    // (健壮性检查) 如果没有激活的链接，则退出
    if (!currentModuleLink) return;
    const currentModule = currentModuleLink.dataset.module;

    // 2. [!!] (修改) 如果是“多次考试分析”，则特殊处理
    if (currentModule === 'multi-exam') {
        // 这个模块不依赖 G_StudentsData，直接渲染
        // (renderModule 会自动找到正确的 container 并调用 renderMultiExam)
        renderModule(currentModule, [], []);
        return; // [!!] (重要) 渲染后立即退出，跳过后续所有逻辑
    }

    // 3. [!!] (原第1行) 对所有其他模块，执行数据检查
    if (G_StudentsData.length === 0) {
        console.warn("runAnalysisAndRender: G_StudentsData 为空，已退出。");
        return;
    }

    // 4. (新增) 根据班级筛选
    const currentFilter = classFilterSelect.value;
    let activeData = G_StudentsData;
    let activeCompareData = G_CompareData;

    if (currentFilter !== 'ALL') {
        activeData = G_StudentsData.filter(s => s.class === currentFilter);

        if (G_CompareData.length > 0) {
            activeCompareData = G_CompareData.filter(s => s.class === currentFilter);
        }
    }

    // 5. (重构) 重新计算统计数据
    G_Statistics = calculateAllStatistics(activeData);
    if (activeCompareData.length > 0) {
        G_CompareStatistics = calculateAllStatistics(activeCompareData);
    }

    // 6. (重构) 渲染当前激活的模块
    // (currentModule 已在最前面获取)
    renderModule(currentModule, activeData, activeCompareData);
}

/**
 * (重构) 7.2. 模块渲染的“路由器”
 * [!!] 已新增 case 'weakness'
 */
function renderModule(moduleName, activeData, activeCompareData) {
    modulePanels.forEach(p => p.style.display = 'none');
    const container = document.getElementById(`module-${moduleName}`);
    if (!container) return;
    container.style.display = 'block';

    // (重构) G_Statistics 已经是算好的
    switch (moduleName) {
        case 'dashboard':
            renderDashboard(container, G_Statistics, activeData);
            break;
        case 'student':
            renderStudent(container, activeData, G_Statistics);
            break;
        case 'paper':
            renderPaper(container, G_Statistics, activeData);
            break;
        case 'single-subject':
            renderSingleSubject(container, activeData, G_Statistics);
            break;

        // [!!] (新增) 3个新模块的路由
        case 'boundary':
            renderBoundary(container, activeData, G_Statistics);
            break;
        case 'holistic':
            renderHolisticBalance(container, activeData, G_Statistics);
            break;
        case 'trend-distribution':
            renderTrendDistribution(container, activeData, activeCompareData, G_Statistics, G_CompareStatistics, G_CurrentClassFilter); // [!!] (新增) 传入 G_CurrentClassFilter
            break;
        case 'multi-exam':
            renderMultiExam(container);
            break;
        case 'trend':
            renderTrend(container, activeData, activeCompareData);
            break;
        case 'groups':
            renderGroups(container, activeData);
            break;
        case 'correlation':
            renderCorrelation(container, activeData);
            break;
        // [!!] (新增) 偏科诊断
        case 'weakness':
            renderWeakness(container, activeData, G_Statistics); // [!!] (新增) 传入 G_Statistics
            break;
        default:
            container.innerHTML = `<h2>模块 ${moduleName} (待开发)</h2>`;
    }
}

/**
 * (新增) 7.3. 填充班级筛选
 */
function populateClassFilter(students) {
    const classes = [...new Set(students.map(s => s.class))].sort();

    let html = `<option value="ALL">-- 全体年段 --</option>`;
    html += classes.map(c => `<option value="${c}">${c}</option>`).join('');

    classFilterSelect.innerHTML = html;
    G_CurrentClassFilter = 'ALL';
}

// ---------------------------------
// 8. 科目配置 (Modal)
// ---------------------------------

/**
 * (新增) 8.1. 初始化 G_SubjectConfigs
 * [!!] 已新增 'good' 默认值
 */
function initializeSubjectConfigs() {
    G_SubjectConfigs = {};
    G_DynamicSubjectList.forEach(subject => {
        // 默认 语数英 150，其他 100
        const isY_S_W = ['语文', '数学', '英语'].includes(subject);

        // (旧值)
        const full = isY_S_W ? 150 : 100;
        const pass = isY_S_W ? 90 : 60;
        const excel = isY_S_W ? 120 : 85;

        G_SubjectConfigs[subject] = {
            full: full,
            excel: excel,
            good: (pass + excel) / 2, // [!!] (新增) 默认值设为及格和优秀的中点
            pass: pass,
        };
    });
}

/**
 * (新增) 8.2. 用 G_SubjectConfigs 填充模态窗口
 * [!!] 已新增 'good' 输入框
 */
function populateSubjectConfigModal() {
    let html = '';
    G_DynamicSubjectList.forEach(subject => {
        const config = G_SubjectConfigs[subject];
        html += `
            <tr>
                <td><strong>${subject}</strong></td>
                <td><input type="number" data-subject="${subject}" data-type="full" value="${config.full}"></td>
                <td><input type="number" data-subject="${subject}" data-type="excel" value="${config.excel}"></td>
                <td><input type="number" data-subject="${subject}" data-type="good" value="${config.good}"></td> <td><input type="number" data-subject="${subject}" data-type="pass" value="${config.pass}"></td>
            </tr>
        `;
    });
    subjectConfigTableBody.innerHTML = html;
}

/**
 * (新增) 8.3. 从模态窗口保存配置到 G_SubjectConfigs
 */
function saveSubjectConfigsFromModal() {
    const inputs = subjectConfigTableBody.querySelectorAll('input');
    inputs.forEach(input => {
        const subject = input.dataset.subject;
        const type = input.dataset.type;
        const value = parseFloat(input.value);

        if (G_SubjectConfigs[subject]) {
            G_SubjectConfigs[subject][type] = value;
        }
    });
    localStorage.setItem('G_SubjectConfigs', JSON.stringify(G_SubjectConfigs));
}


// ---------------------------------
// 9. 各模块具体实现
// ---------------------------------
/**
 * 9.1. 模块一：班级整体分析 (已重构为 2x2 网格，新增班级对比)
 * [!!] drawHistogram 已修改，以支持新版 renderHistogram
 */
function renderDashboard(container, stats, activeData) {
    const totalStats = stats.totalScore || {};

    // [!!] (核心修改) 计算总人数、参考人数、缺考人数
    const totalStudentCount = activeData.length; // (总人数 = 筛选器内的所有学生)
    const participantCount = totalStats.count || 0; // (考试人数 = 有总分的学生)
    const missingCount = totalStudentCount - participantCount; // (缺考人数)

    // 1. 渲染 KPI 卡片 (已修改)
    container.innerHTML = `
        <h2>模块一：班级整体分析 (当前筛选: ${G_CurrentClassFilter})</h2>
        <div class="kpi-grid">
            <div class="kpi-card"><h3>总人数</h3><div class="value">${totalStudentCount}</div></div>
            <div class="kpi-card"><h3>考试人数</h3><div class="value">${participantCount}</div></div>
            <div class="kpi-card"><h3>缺考人数</h3><div class="value">${missingCount}</div></div>
            <div class="kpi-card"><h3>总分平均分</h3><div class="value">${totalStats.average || 0}</div></div>
            <div class="kpi-card"><h3>总分最高分</h3><div class="value">${totalStats.max || 0}</div></div>
            <div class="kpi-card"><h3>总分最低分</h3><div class="value">${totalStats.min || 0}</div></div>
            <div class="kpi-card"><h3>总分中位数</h3><div class="value">${totalStats.median || 0}</div></div>
            <div class="kpi-card"><h3>总分优秀率 (%)</h3><div class="value">${totalStats.excellentRate || 0}</div></div>
            <div class="kpi-card"><h3>总分良好率 (%)</h3><div class="value">${totalStats.goodRate || 0}</div></div>
            <div class="kpi-card"><h3>总分及格率 (%)</h3><div class="value">${totalStats.passRate || 0}</div></div>
            <div class="kpi-card"><h3>总分不及格率 (%)</h3><div class="value">${totalStats.failRate || 0}</div></div>
            <div class="kpi-card"><h3>总分标准差</h3><div class="value">${totalStats.stdDev || 0}</div></div>
        </div>

        <div class="main-card-wrapper" style="margin-bottom: 20px;">
            <h3>全科统计表</h3>
            <div class="table-container" style="max-height: 400px;">
                <table>
                    <thead>
                        <tr>
                            <th>科目</th>
                            <th>考试人数</th>
                            <th>平均分</th>
                            <th>最高分</th>
                            <th>中位数</th>
                            <th>优秀率 (%)</th>
                            <th>良好率 (%)</th> 
                            <th>及格率 (%)</th>
                            <th>标准差</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr class="total-score-row">
                            <td><strong>${stats.totalScore.name}</strong></td>
                            <td>${stats.totalScore.count}</td>
                            <td>${stats.totalScore.average}</td>
                            <td>${stats.totalScore.max}</td>
                            <td>${stats.totalScore.median}</td>
                            <td>${stats.totalScore.excellentRate}</td>
                            <td>${stats.totalScore.goodRate || 0}</td> 
                            <td>${stats.totalScore.passRate}</td>
                            <td>${stats.totalScore.stdDev || 0}</td>
                        </tr>
                        ${G_DynamicSubjectList.map(subject => stats[subject]).filter(s => s).map(s => `
                            <tr>
                                <td><strong>${s.name}</strong></td>
                                <td>${s.count}</td>
                                <td>${s.average}</td>
                                <td>${s.max}</td>
                                <td>${s.median}</td>
                                <td>${s.excellentRate}</td>
                                <td>${s.goodRate || 0}</td> 
                                <td>${s.passRate}</td>
                                <td>${s.stdDev || 0}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>

        <div class="dashboard-chart-grid-2x2">
            
            <div class="main-card-wrapper">
                <div class="controls-bar chart-controls">
                    <h4 style="margin:0;">全科分数分布箱形图</h4>
                </div>
                <div class="chart-container" id="subject-boxplot-chart" style="height: 350px;"></div>
            </div>

            <div class="main-card-wrapper">
                 <div class="controls-bar chart-controls">
                    <label for="class-compare-subject">科目:</label>
                    <select id="class-compare-subject" class="sidebar-select" style="min-width: 100px;">
                        <option value="totalScore">总分</option>
                        ${G_DynamicSubjectList.map(s => `<option value="${s}">${s}</option>`).join('')}
                    </select>
                    <label for="class-compare-metric">指标:</label>
                    <select id="class-compare-metric" class="sidebar-select" style="min-width: 120px;">
                        <option value="average">平均分</option>
                        <option value="passRate">及格率 (%)</option>
                        <option value="stdDev">标准差</option>
                        <option value="max">最高分</option>
                        <option value="median">中位数</option>
                    </select>
                </div>
                <div class="chart-container" id="class-compare-chart" style="height: 350px;"></div>
            </div>

            <div class="main-card-wrapper">
                <div class="chart-container" id="radar-chart" style="height: 400px;"></div>
            </div>

            <div class="main-card-wrapper">
                 <div class="controls-bar chart-controls">
                    <label for="histogram-bin-size">分段大小:</label>
                    <input type="number" id="histogram-bin-size" value="30" style="width: 60px;">
                    <button id="histogram-redraw-btn" class="sidebar-button" style="width: auto;">重绘</button>
                </div>
                <div class="chart-container" id="histogram-chart" style="height: 350px;"></div>
            </div>

            <div class="main-card-wrapper">
                <div class="controls-bar chart-controls">
                    <label for="scatter-x-subject">X轴:</label>
                    <select id="scatter-x-subject" class="sidebar-select">
                        ${G_DynamicSubjectList.map(s => `<option value="${s}">${s}</option>`).join('')}
                    </select>
                    <label for="scatter-y-subject">Y轴:</label>
                    <select id="scatter-y-subject" class="sidebar-select">
                        ${G_DynamicSubjectList.map((s, i) => `<option value="${s}" ${i === 1 ? 'selected' : ''}>${s}</option>`).join('')}
                    </select>
                </div>
                <div class="chart-container" id="correlation-scatter-chart" style="height: 350px;"></div>
            </div>

            <div class="main-card-wrapper">
                <div class="controls-bar chart-controls">
                    <h4 style="margin:0;">各科 A/B/C/D 构成 (百分比)</h4>
                </div>
                <div class="chart-container" id="stacked-bar-chart" style="height: 350px;"></div>
            </div>

        </div>
    `;

    // 4. 渲染图表
    const drawHistogram = () => {
        // [!!] 核心修改
        if (totalStats.scores && totalStats.scores.length > 0) {
            const fullScore = G_DynamicSubjectList.reduce((sum, key) => sum + (G_SubjectConfigs[key]?.full || 0), 0);
            const binSize = parseInt(document.getElementById('histogram-bin-size').value) || 30;
            renderHistogram(
                'histogram-chart',
                activeData,     // [!!] 传入完整学生数据
                'totalScore',   // [!!] 告知函数使用哪个分数key
                fullScore,
                `总分分数段直方图 (分段=${binSize})`,
                binSize
            );
        }
    };

    // 5. (新增) 班级对比图的事件
    const classSubjectSelect = document.getElementById('class-compare-subject');
    const classMetricSelect = document.getElementById('class-compare-metric');

    const drawClassCompareChart = () => {
        const subject = classSubjectSelect.value;
        const metric = classMetricSelect.value;
        if (G_CurrentClassFilter === 'ALL') {
            const data = calculateClassComparison(metric, subject);
            let subjectName = subject === 'totalScore' ? '总分' : subject;
            let metricName = classMetricSelect.options[classMetricSelect.selectedIndex].text;
            renderClassComparisonChart('class-compare-chart', data, `各班级 - ${subjectName} ${metricName} 对比`);
        } else {
            document.getElementById('class-compare-chart').innerHTML = `<p style="text-align: center; color: var(--text-muted); padding-top: 50px;">请在侧边栏选择 "全体年段" 以查看班级对比。</p>`;
        }
    };

    // (新增) 散点图的事件
    const scatterXSelect = document.getElementById('scatter-x-subject');
    const scatterYSelect = document.getElementById('scatter-y-subject');

    const drawScatterPlot = () => {
        const xSubject = scatterXSelect.value;
        const ySubject = scatterYSelect.value;
        renderCorrelationScatterPlot('correlation-scatter-chart', activeData, xSubject, ySubject);
    };

    // 6. 绑定事件
    document.getElementById('histogram-redraw-btn').addEventListener('click', drawHistogram);
    scatterXSelect.addEventListener('change', drawScatterPlot);
    scatterYSelect.addEventListener('change', drawScatterPlot);
    classSubjectSelect.addEventListener('change', drawClassCompareChart);
    classMetricSelect.addEventListener('change', drawClassCompareChart);

    // 7. 初始绘制
    drawHistogram();
    drawClassCompareChart();
    renderAverageRadar('radar-chart', stats);
    renderSubjectBoxPlot('subject-boxplot-chart', G_Statistics, activeData); // [!!] (新增) 传入 activeData
    renderStackedBar('stacked-bar-chart', G_Statistics, G_SubjectConfigs);
    drawScatterPlot();
}

/**
 * 9.2. 模块二：学生个体报告 (已集成“进退步”对比)
 * [!!] 已修改：为 student-card 增加了 sc-xxx 类，用于CSS美化
 */
function renderStudent(container, students, stats) {

    // 1. (重写) 渲染搜索框 和 结果容器
    container.innerHTML = `
        <h2>模块二：学生个体报告 (当前筛选: ${G_CurrentClassFilter})</h2>
        <div class="controls-bar">
            <label for="student-search">搜索学生 (姓名/考号):</label>
            <div class="search-combobox">
                <input type="text" id="student-search" placeholder="输入姓名或考号..." autocomplete="off">
                <div class="search-results" id="student-search-results"></div>
            </div>
        </div>
        <div id="student-report-content">
            <p>请输入关键词以搜索学生。</p>
        </div>
    `;

    // 2. (重写) 绑定新搜索框的事件
    const searchInput = document.getElementById('student-search');
    const resultsContainer = document.getElementById('student-search-results');
    const contentEl = document.getElementById('student-report-content');

    // 这是一个辅助函数，用于显示学生的详细报告
    const showReport = (studentId) => {
        const student = students.find(s => String(s.id) === String(studentId));
        if (!student) {
            contentEl.innerHTML = `<p>未找到学生。</p>`;
            return;
        }

        // ======================================================
        // ▼▼▼ (核心修改) 查找对比数据并计算进退步 ▼▼▼
        // ======================================================
        let oldStudent = null;
        let scoreDiff = 'N/A', rankDiff = 'N/A', gradeRankDiff = 'N/A';

        // 检查 G_CompareData 是否存在
        if (G_CompareData && G_CompareData.length > 0) {
            oldStudent = G_CompareData.find(s => String(s.id) === String(student.id));
        }

        if (oldStudent) {
            scoreDiff = (student.totalScore - oldStudent.totalScore).toFixed(2);
            rankDiff = oldStudent.rank - student.rank; // 排名：旧-新，正数为进步
            gradeRankDiff = (oldStudent.gradeRank && student.gradeRank) ? oldStudent.gradeRank - student.gradeRank : 'N/A';
        }

        // [!!] (美化) 核心修改点：在 student-card 的 div 上添加了 sc-xxx 类
        contentEl.innerHTML = `
            <div class="student-card">
                <div class="sc-name"><span>姓名</span><strong>${student.name}</strong></div>
                <div class="sc-id"><span>考号</span><strong>${student.id}</strong></div>
                
                <div class="sc-total">
                    <span>总分 (上次: ${oldStudent ? oldStudent.totalScore : 'N/A'})</span>
                    <strong class="${scoreDiff > 0 ? 'progress' : scoreDiff < 0 ? 'regress' : ''}">
                        ${student.totalScore}
                        ${(scoreDiff !== 'N/A' && oldStudent) ? `(${scoreDiff > 0 ? '▲' : '▼'} ${Math.abs(scoreDiff)})` : ''}
                    </strong>
                </div>

                <div class="sc-rank">
                    <span>班级排名 (上次: ${oldStudent ? oldStudent.rank : 'N/A'})</span>
                    <strong class="${rankDiff > 0 ? 'progress' : rankDiff < 0 ? 'regress' : ''}">
                        ${student.rank}
                        ${(rankDiff !== 'N/A' && oldStudent) ? `(${rankDiff > 0 ? '▲' : '▼'} ${Math.abs(rankDiff)})` : ''}
                    </strong>
                </div>

                <div class="sc-grade-rank">
                    <span>年级排名 (上次: ${oldStudent ? (oldStudent.gradeRank || 'N/A') : 'N/A'})</span>
                    <strong class="${gradeRankDiff > 0 ? 'progress' : gradeRankDiff < 0 ? 'regress' : ''}">
                        ${student.gradeRank || 'N/A'}
                        ${(gradeRankDiff !== 'N/A' && oldStudent) ? `(${gradeRankDiff > 0 ? '▲' : '▼'} ${Math.abs(gradeRankDiff)})` : ''}
                    </strong>
                </div>
            </div>
            
                    <div class="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>科目</th>
                                    <th>得分 (变化)</th>
                                    <th>班级科目排名 (变化)</th>
                                    <th>年级科目排名 (变化)</th>
                                </tr>
                            </thead>
                            <tbody>

                                ${G_DynamicSubjectList.map(subject => {
            let subjectScoreDiff = 'N/A';
            let subjectClassRankDiff = 'N/A'; // [!!] (新增)
            let subjectGradeRankDiff = 'N/A'; // [!!] (重命名)

            if (oldStudent && oldStudent.scores) {
                // 得分变化 (不变)
                const oldScore = oldStudent.scores[subject] || 0;
                const newScore = student.scores[subject] || 0;
                if (oldScore !== 0 || newScore !== 0) {
                    subjectScoreDiff = (newScore - oldScore).toFixed(2);
                }

                // [!!] (新增) 班级科目排名变化
                if (oldStudent.classRanks && student.classRanks) {
                    const oldClassRank = oldStudent.classRanks[subject] || 0;
                    const newClassRank = student.classRanks[subject] || 0;
                    if (oldClassRank > 0 && newClassRank > 0) {
                        subjectClassRankDiff = oldClassRank - newClassRank;
                    }
                }

                // [!!] (修改) 年级科目排名变化
                if (oldStudent.gradeRanks && student.gradeRanks) {
                    const oldGradeRank = oldStudent.gradeRanks[subject] || 0;
                    const newGradeRank = student.gradeRanks[subject] || 0;
                    if (oldGradeRank > 0 && newGradeRank > 0) {
                        subjectGradeRankDiff = oldGradeRank - newGradeRank;
                    }
                }
            }

            return `
                                    <tr>
                                        <td>${subject}</td>
                                        <td>
                                            ${student.scores[subject] || 0}
                                            ${(oldStudent && subjectScoreDiff !== 'N/A') ? `<span class="${subjectScoreDiff > 0 ? 'progress' : subjectScoreDiff < 0 ? 'regress' : ''}">(${subjectScoreDiff > 0 ? '▲' : '▼'} ${Math.abs(subjectScoreDiff)})</span>` : ''}
                                        </td>
                                        <td>
                                            ${student.classRanks ? (student.classRanks[subject] || 'N/A') : 'N/A'}
                                            ${(oldStudent && subjectClassRankDiff !== 'N/A') ? `<span class="${subjectClassRankDiff > 0 ? 'progress' : subjectClassRankDiff < 0 ? 'regress' : ''}">(${subjectClassRankDiff > 0 ? '▲' : '▼'} ${Math.abs(subjectClassRankDiff)})</span>` : ''}
                                        </td>
                                        <td>
                                            ${student.gradeRanks ? (student.gradeRanks[subject] || 'N/A') : 'N/A'}
                                            ${(oldStudent && subjectGradeRankDiff !== 'N/A') ? `<span class="${subjectGradeRankDiff > 0 ? 'progress' : subjectGradeRankDiff < 0 ? 'regress' : ''}">(${subjectGradeRankDiff > 0 ? '▲' : '▼'} ${Math.abs(subjectGradeRankDiff)})</span>` : ''}
                                        </td>
                                    </tr>
                                    `;
        }).join('')}
                    </tbody>
                </table>
            </div>

            <div class="main-card-wrapper" style="margin-top: 20px;">
                <div class="chart-container" id="student-radar-chart" style="height: 400px;"></div>
            </div>
        `;

        // (不变) 渲染雷达图
        renderStudentRadar('student-radar-chart', student, stats);
    };

    // 3. (不变) 监听搜索框的输入事件
    searchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();

        if (searchTerm.length < 1) {
            resultsContainer.innerHTML = '';
            resultsContainer.style.display = 'none';
            return;
        }

        const filteredStudents = students.filter(s => {
            return String(s.name).toLowerCase().includes(searchTerm) ||
                String(s.id).toLowerCase().includes(searchTerm);
        }).slice(0, 50);

        if (filteredStudents.length === 0) {
            resultsContainer.innerHTML = '<div class="result-item">-- 未找到 --</div>';
        } else {
            resultsContainer.innerHTML = filteredStudents.map(s => {
                return `<div class="result-item" data-id="${s.id}">
                    <strong>${s.name}</strong> (${s.id}) - 班排: ${s.rank}
                </div>`;
            }).join('');
        }
        resultsContainer.style.display = 'block';
    });

    // 4. (不变) 监听下拉选项的点击事件
    resultsContainer.addEventListener('click', (e) => {
        const item = e.target.closest('.result-item');
        if (item && item.dataset.id) {
            const studentId = item.dataset.id;

            searchInput.value = `${item.querySelector('strong').innerText} (${studentId})`;
            resultsContainer.innerHTML = '';
            resultsContainer.style.display = 'none';

            showReport(studentId);
        }
    });

    // 5. (不变) 当用户点击页面其他地方时，隐藏下拉菜单
    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !resultsContainer.contains(e.target)) {
            resultsContainer.style.display = 'none';
        }
    });

    // 6. (不变) 当用户重新聚焦搜索框时，如果已有结果则显示
    searchInput.addEventListener('focus', () => {
        if (resultsContainer.innerHTML !== '') {
            resultsContainer.style.display = 'block';
        }
    });
}

/**
 * 9.3. 模块三：试卷科目分析
 * [!!] 已修改：签名增加 activeData, drawChart 传递 activeData
 */
function renderPaper(container, stats, activeData) {
    // 1. (重构) 渲染 1x4 垂直布局
    container.innerHTML = `
        <h2>模块三：试卷科目分析 (当前筛选: ${G_CurrentClassFilter})</h2>
        
        <div class="main-card-wrapper" style="margin-bottom: 20px;">
            <div class="controls-bar chart-controls">
                <label for="subject-select">选择科目:</label>
                <select id="subject-select" class="sidebar-select">
                    <option value="totalScore">总分</option>
                    ${G_DynamicSubjectList.map(s => `<option value="${s}">${s}</option>`).join('')}
                </select>
                
                <label for="paper-bin-size">分段大小:</label>
                <input type="number" id="paper-bin-size" value="10" style="width: 60px;">
                <button id="paper-redraw-btn" class="sidebar-button" style="width: auto;">重绘</button>
            </div>
            <div class="chart-container" id="subject-histogram-chart" style="width: 100%; height: 500px;"></div>
        </div>

        <div class="main-card-wrapper" style="margin-bottom: 20px;">
            <div class="controls-bar chart-controls">
                <h4 style="margin:0;">各科难度系数对比</h4>
                <span style="font-size: 0.8em; color: var(--text-muted);">(难度 = 平均分 / 满分, 越高越简单)</span>
            </div>
            <div class="chart-container" id="difficulty-chart" style="width: 100%; height: 500px;"></div>
        </div>

        <div class="main-card-wrapper" style="margin-bottom: 20px;">
            <div class="controls-bar chart-controls">
                <h4 style="margin:0;">各科区分度对比 (标准差)</h4>
                <span style="font-size: 0.8em; color: var(--text-muted);">(标准差越大, 越能拉开差距)</span>
            </div>
            <div class="chart-container" id="discrimination-chart" style="width: 100%; height: 500px;"></div>
        </div>

        <div class="main-card-wrapper"> <div class="controls-bar chart-controls">
                <h4 style="margin:0;">难度-区分度 散点图</h4>
            </div>
            <div class="chart-container" id="difficulty-scatter-chart" style="width: 100%; height: 500px;"></div>
        </div>
    `;

    // 2. (重构) 绘制直方图
    const drawChart = () => {
        // [!!] 核心修改
        const subjectName = document.getElementById('subject-select').value;
        const binSize = parseInt(document.getElementById('paper-bin-size').value) || 10;
        const s = stats[subjectName];
        if (!s) return;

        let fullScore;
        if (subjectName === 'totalScore') {
            fullScore = G_DynamicSubjectList.reduce((sum, key) => sum + (G_SubjectConfigs[key]?.full || 0), 0);
        } else {
            fullScore = G_SubjectConfigs[subjectName]?.full || 100;
        }

        renderHistogram(
            'subject-histogram-chart',
            activeData,     // [!!] 传入完整学生数据
            subjectName,    // [!!] 告知函数使用哪个分数key
            fullScore,
            `${s.name} 分数段直方图 (均分: ${s.average}, 分段=${binSize})`,
            binSize
        );
    };

    // 3. (重构) 绑定事件 (不变)
    document.getElementById('subject-select').addEventListener('change', drawChart);
    document.getElementById('paper-redraw-btn').addEventListener('click', drawChart);

    // 4. (新增) 绘制新图表
    renderSubjectComparisonBarChart('difficulty-chart', stats, 'difficulty');
    renderSubjectComparisonBarChart('discrimination-chart', stats, 'stdDev');
    renderDifficultyScatter('difficulty-scatter-chart', stats);

    // 5. 默认绘制总分
    drawChart('totalScore');
}


/**
 * (新增) 9.3.5. 模块：单科成绩分析
 * @param {Object} container - HTML 容器
 * @param {Array} activeData - 当前已筛选的学生数据
 * @param {Object} stats - G_Statistics (全体统计)
 */
function renderSingleSubject(container, activeData, stats) {

    // 1. 渲染基础HTML
    container.innerHTML = `
        <h2>模块四：单科成绩分析 (当前筛选: ${G_CurrentClassFilter})</h2>

        <div class="main-card-wrapper" style="margin-bottom: 20px;">
            <div class="controls-bar chart-controls">
                <label for="ss-subject-select">选择科目:</label>
                <select id="ss-subject-select" class="sidebar-select">
                    ${G_DynamicSubjectList.map((s, i) => `<option value="${s}" ${i === 0 ? 'selected' : ''}>${s}</option>`).join('')}
                </select>
            </div>
        </div>

        <div id="ss-kpi-grid" class="kpi-grid" style="margin-bottom: 20px;">
            </div>

        <div class="dashboard-chart-grid-2x2">
            <div class="main-card-wrapper">
                <h4 style="margin:0;">分数段直方图</h4>
                <div class="chart-container" id="ss-histogram-chart" style="height: 350px;"></div>
            </div>

            <div class="main-card-wrapper">
                <div class="controls-bar chart-controls">
                    <label for="ss-class-compare-metric">对比指标:</label>
                    <select id="ss-class-compare-metric" class="sidebar-select" style="min-width: 120px;">
                        <option value="average">平均分</option>
                        <option value="passRate">及格率 (%)</option>
                        <option value="excellentRate">优秀率 (%)</option>
                        <option value="stdDev">标准差</option>
                        <option value="max">最高分</option>
                    </select>
                </div>
                <div class="chart-container" id="ss-class-compare-chart" style="height: 350px;"></div>
            </div>

            <div class="main-card-wrapper">
                <h4 style="margin:0;">A/B/C/D 等级构成</h4>
                <div class="chart-container" id="ss-abcd-pie-chart" style="height: 400px;"></div>
            </div>

            <div class="main-card-wrapper">
                <h4 style="margin:0;">本科目 Top 10</h4>
                <div class="table-container" id="ss-top10-table" style="max-height: 400px;"></div>
            </div>
            <div class="main-card-wrapper">
                <h4 style="margin:0;">本科目 Bottom 10</h4>
                <div class="table-container" id="ss-bottom10-table" style="max-height: 400px;"></div>
            </div>
        </div>
    `;

    // 2. 内部辅助函数：用于渲染所有图表和表格
    const drawAnalysis = () => {
        const subjectName = document.getElementById('ss-subject-select').value;
        if (!subjectName) return;

        const subjectStats = stats[subjectName] || {};
        const config = G_SubjectConfigs[subjectName] || {};
        const fullScore = config.full || 100;

        // 2.1 渲染KPIs (不变)
        const kpiContainer = document.getElementById('ss-kpi-grid');
        kpiContainer.innerHTML = `
            <div class="kpi-card"><h3>平均分</h3><div class="value">${subjectStats.average || 0}</div></div>
            <div class="kpi-card"><h3>最高分</h3><div class="value">${subjectStats.max || 0}</div></div>
            <div class="kpi-card"><h3>最低分</h3><div class="value">${subjectStats.min || 0}</div></div>
            <div class="kpi-card"><h3>优秀率 (%)</h3><div class="value">${subjectStats.excellentRate || 0}</div></div>
            <div class="kpi-card"><h3>良好率 (%)</h3><div class="value">${subjectStats.goodRate || 0}</div></div>
            <div class="kpi-card"><h3>及格率 (%)</h3><div class="value">${subjectStats.passRate || 0}</div></div>
            <div class="kpi-card"><h3>不及格率 (%)</h3><div class="value">${subjectStats.failRate || 0}</div></div>
            <div class="kpi-card"><h3>标准差</h3><div class="value">${subjectStats.stdDev || 0}</div></div>
        `;

        // 2.2 渲染直方图 (不变)
        renderHistogram(
            'ss-histogram-chart',
            activeData,
            subjectName,
            fullScore,
            `${subjectName} 分数段直方图`,
            Math.round(fullScore / 15) // 动态分段，约15段
        );

        // 2.3 [!!] (新) 渲染班级对比图
        const metricSelect = document.getElementById('ss-class-compare-metric');
        const drawClassCompareChart = () => {
            const metric = metricSelect.value;
            const chartEl = document.getElementById('ss-class-compare-chart');

            if (G_CurrentClassFilter !== 'ALL') {
                chartEl.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding-top: 50px;">请在侧边栏选择 "全体年段" 以查看班级对比。</p>`;
                return;
            }

            // (复用) 调用班级对比数据计算函数
            const data = calculateClassComparison(metric, subjectName);
            let metricName = metricSelect.options[metricSelect.selectedIndex].text;
            // (复用) 调用班级对比图渲染函数
            renderClassComparisonChart('ss-class-compare-chart', data, `各班级 - ${subjectName} ${metricName}`);
        };

        // (绑定事件)
        metricSelect.addEventListener('change', drawClassCompareChart);
        // (初始绘制)
        drawClassCompareChart();


        // 2.4 [!!] (新) 渲染饼图
        renderSingleSubjectPie('ss-abcd-pie-chart', subjectStats);


        // 2.5 渲染 Top/Bottom 表格 (不变)
        const sortedStudents = [...activeData]
            .filter(s => s.scores[subjectName] !== null && s.scores[subjectName] !== undefined)
            .sort((a, b) => (b.scores[subjectName]) - (a.scores[subjectName]));

        const top10 = sortedStudents.slice(0, 10);
        const bottom10 = sortedStudents.slice(-10).reverse();

        const createTable = (data, rankType) => {
            let rankHeader = rankType === 'top' ? '排名' : '倒数';
            if (data.length === 0) return '<p style="text-align: center; color: var(--text-muted); padding-top: 20px;">无数据</p>';

            return `
                <table>
                    <thead><tr><th>${rankHeader}</th><th>姓名</th><th>分数</th><th>班排</th></tr></thead>
                    <tbody>
                        ${data.map((s, index) => `
                            <tr>
                                <td>${index + 1}</td>
                                <td>${s.name}</td>
                                <td><strong>${s.scores[subjectName]}</strong></td>
                                <td>${s.rank}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        };

        document.getElementById('ss-top10-table').innerHTML = createTable(top10, 'top');
        document.getElementById('ss-bottom10-table').innerHTML = createTable(bottom10, 'bottom');
    };

    // 3. 绑定主事件
    document.getElementById('ss-subject-select').addEventListener('change', drawAnalysis);

    // 4. 初始绘制 (默认使用列表中的第一个科目)
    drawAnalysis();
}

/**
 * 9.4. 模块四：成绩趋势对比
 * [!!] 已修改：删除 "进退步一览" 图，布局变为 1x1
 * [!!] (已合并) "年排" 列, "姓名/考号" 排序, "学生进退步条形图"
 */
function renderTrend(container, currentData, compareData) {

    if (!compareData || compareData.length === 0) {
        container.innerHTML = `<h2>模块十一：成绩趋势对比 (当前筛选: ${G_CurrentClassFilter})</h2><p>请先在侧边栏导入 "对比成绩" 数据。</p>`;
        return;
    }

    // 1. (核心) 匹配两个数据源 (不变)
    const mergedData = currentData.map(student => {
        const oldStudent = compareData.find(s => String(s.id) === String(student.id));

        if (!oldStudent) {
            return {
                ...student,
                oldTotalScore: null, oldRank: null, oldGradeRank: null,
                scoreDiff: 0, rankDiff: 0, gradeRankDiff: 0
            };
        }

        const scoreDiff = student.totalScore - oldStudent.totalScore;
        const rankDiff = oldStudent.rank - student.rank;
        const gradeRankDiff = (oldStudent.gradeRank && student.gradeRank) ? oldStudent.gradeRank - student.gradeRank : 0;

        return {
            ...student,
            oldTotalScore: oldStudent.totalScore,
            oldRank: oldStudent.rank,
            oldGradeRank: oldStudent.gradeRank || null,
            scoreDiff: parseFloat(scoreDiff.toFixed(2)),
            rankDiff: rankDiff,
            gradeRankDiff: gradeRankDiff
        };
    });

    // 2. (新增) 这是一个辅助函数，用于根据数据生成表格行 (不变)
    const renderTableRows = (dataToRender) => {
        return dataToRender.map(s => `
            <tr>
               <td>${s.id}</td>
                <td>${s.name}</td>
                <td><strong>${s.totalScore}</strong> (上次: ${s.oldTotalScore ?? 'N/A'})</td>
                <td class="${s.scoreDiff > 0 ? 'progress' : s.scoreDiff < 0 ? 'regress' : ''}">
                    ${s.scoreDiff > 0 ? '▲' : s.scoreDiff < 0 ? '▼' : ''} ${Math.abs(s.scoreDiff)}
                </td>
                <td><strong>${s.rank}</strong></td>
                <td class="${s.rankDiff > 0 ? 'progress' : s.rankDiff < 0 ? 'regress' : ''}">
                    ${s.rankDiff > 0 ? '▲' : s.rankDiff < 0 ? '▼' : ''} ${Math.abs(s.rankDiff)} (上次: ${s.oldRank ?? 'N/A'})
                </td>
                <td>${s.gradeRank ?? 'N/A'}</td>
                <td class="${s.gradeRankDiff > 0 ? 'progress' : s.gradeRankDiff < 0 ? 'regress' : ''}">
                    ${s.gradeRankDiff > 0 ? '▲' : s.gradeRankDiff < 0 ? '▼' : ''} ${Math.abs(s.gradeRankDiff)} (上次: ${s.oldGradeRank ?? 'N/A'})
                </td>
            </tr>
        `).join('');
    };

    // 3. (新增) 核心：排序和渲染表格的函数 (不变)
    const drawTable = () => {
        const searchTerm = document.getElementById('trend-search').value.toLowerCase();

        const filteredData = mergedData.filter(s => {
            return String(s.name).toLowerCase().includes(searchTerm) ||
                String(s.id).toLowerCase().includes(searchTerm);
        });

        const { key, direction } = G_TrendSort;
        filteredData.sort((a, b) => {
            let valA = a[key];
            let valB = b[key];
            valA = (valA === null || valA === undefined) ? (direction === 'asc' ? Infinity : -Infinity) : valA;
            valB = (valB === null || valB === undefined) ? (direction === 'asc' ? Infinity : -Infinity) : valB;

            if (typeof valA === 'string' || typeof valB === 'string') {
                valA = String(valA);
                valB = String(valB);
                return direction === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
            } else {
                return direction === 'asc' ? valA - valB : valB - valA;
            }
        });

        document.getElementById('trend-table-body').innerHTML = renderTableRows(filteredData);

        document.querySelectorAll('#trend-table-header th[data-sort-key]').forEach(th => {
            th.classList.remove('sort-asc', 'sort-desc');
            if (th.dataset.sortKey === key) {
                th.classList.add(direction === 'asc' ? 'sort-asc' : 'sort-desc');
            }
        });
    };

    // 4. (新增) 绘制图表的函数
    const drawCharts = () => {
        const classFilter = document.getElementById('trend-class-filter').value;
        const sortFilter = document.getElementById('trend-sort-filter').value; // [!!] (新增) 获取排序值

        const scatterData = (classFilter === 'ALL')
            ? mergedData
            : mergedData.filter(s => s.class === classFilter);

        // [!!] (修改) 传入排序参数
        renderRankChangeBarChart('trend-rank-change-bar-chart', scatterData, sortFilter);
    };

    // 5. (重构) 渲染基础HTML
    container.innerHTML = `
        <h2>模块十一：成绩趋势对比 (当前筛选: ${G_CurrentClassFilter})</h2>

        <div class="main-card-wrapper" style="margin-bottom: 20px;">
                <div class="controls-bar chart-controls">
                    <label for="trend-class-filter">班级:</label>
                    <select id="trend-class-filter" class="sidebar-select" style="min-width: 120px;">
                        <option value="ALL">-- 全体年段 --</option>
                        ${[...new Set(currentData.map(s => s.class))].sort().map(c => `<option value="${c}">${c}</option>`).join('')}
                    </select>

                    <label for="trend-sort-filter">排序:</label>
                    <select id="trend-sort-filter" class="sidebar-select" style="min-width: 150px;">
                        <option value="name">按学生姓名 (默认)</option>
                        <option value="rankDiff_desc">按班排变化 (进步最多)</option>
                        <option value="rankDiff_asc">按班排变化 (退步最多)</option>
                        <option value="gradeRankDiff_desc">按年排变化 (进步最多)</option>
                        <option value="gradeRankDiff_asc">按年排变化 (退步最多)</option>
                    </select>
                </div>
            <div class="chart-container" id="trend-rank-change-bar-chart" style="height: 350px;"></div>
        </div>
        <div class="main-card-wrapper">
            <div class="controls-bar" style="background: transparent; box-shadow: none; padding: 0 0 15px 0;">
                <label for="trend-search">搜索学生:</label>
                <input type="text" id="trend-search" placeholder="输入姓名或考号...">
            </div>

            <div class="table-container">
                <table>
                    <thead id="trend-table-header">
                        <tr>
                             <th data-sort-key="id">考号</th>
                            <th data-sort-key="name">姓名</th>
                            <th data-sort-key="totalScore">总分</th>
                            <th data-sort-key="scoreDiff">分数变化</th>
                            <th data-sort-key="rank">班排</th>
                            <th data-sort-key="rankDiff">班排变化</th>
                            <th data-sort-key="gradeRank">年排</th>
                            <th data-sort-key="gradeRankDiff">年排变化</th>
                        </tr>
                    </thead>
                    <tbody id="trend-table-body">
                        </tbody>
                </table>
            </div>
        </div>
    `;

    // 6. (新增) 绑定事件监听器 (不变)
    const searchInput = document.getElementById('trend-search');
    const tableHeader = document.getElementById('trend-table-header');
    const classFilterSelect = document.getElementById('trend-class-filter');
    const sortFilterSelect = document.getElementById('trend-sort-filter'); // [!!] (新增)

    searchInput.addEventListener('input', drawTable);
    classFilterSelect.addEventListener('change', drawCharts);
    sortFilterSelect.addEventListener('change', drawCharts);

    tableHeader.addEventListener('click', (e) => {
        const th = e.target.closest('th[data-sort-key]');
        if (!th) return;

        const newKey = th.dataset.sortKey;
        const { key, direction } = G_TrendSort;

        if (newKey === key) {
            G_TrendSort.direction = (direction === 'asc') ? 'desc' : 'asc';
        } else {
            G_TrendSort.key = newKey;
            G_TrendSort.direction = ['rankDiff', 'scoreDiff', 'gradeRankDiff'].includes(newKey) ? 'desc' : 'asc';
        }
        drawTable();
    });

    // 7. 初始绘制 (不变)
    G_TrendSort = { key: 'rank', direction: 'asc' };
    drawTable();
    drawCharts();
}


/**
 * 9.5. 模块五：学生分层筛选
 * [!!] (关键) A/B/C/D 快捷按钮现在从 config.good 读取
 */
function renderGroups(container, students) {
    // 1. (重构) 渲染筛选器卡片
    container.innerHTML = `
        <h2>模块八：学生分层筛选 (当前筛选: ${G_CurrentClassFilter})</h2>
        
        <div class="main-card-wrapper" style="margin-bottom: 20px;">
            <div class="controls-bar" style="background: transparent; box-shadow: none; padding: 0; margin-bottom: 0; flex-wrap: wrap;">
                <label for="group-subject">筛选科目:</label>
                <select id="group-subject" class="sidebar-select">
                    <option value="totalScore">总分</option>
                    ${G_DynamicSubjectList.map(s => `<option value="${s}">${s}</option>`).join('')}
                </select>
                <input type="number" id="group-min" placeholder="最低分" value="0">
                <label for="group-max"> < 分数 < </label>
                <input type="number" id="group-max" placeholder="最高分" value="900">
                <button id="group-filter-btn" class="sidebar-button">筛选</button>
            </div>
            
            <div class="shortcut-btn-group">
                <label style="font-size: 0.9em; color: var(--text-muted); align-self: center;">快捷方式:</label>
                <button class="shortcut-btn" data-type="A">A (优秀)</button>
                <button class="shortcut-btn" data-type="B">B (良好)</button>
                <button class="shortcut-btn" data-type="C">C (及格)</button>
                <button class="shortcut-btn" data-type="D">D (不及格)</button>
            </div>
        </div>

        <div class="main-card-wrapper" id="group-results-wrapper" style="display: none;">
            
            <div id="group-results-table"></div>

            <div class="dashboard-chart-grid-2x2" style="margin-top: 20px;">
                <div class="main-card-wrapper" style="padding: 10px;"> <div class="chart-container" id="group-class-pie-chart" style="height: 350px;"></div>
                </div>
                <div class="main-card-wrapper" style="padding: 10px;"> <div class="chart-container" id="group-radar-chart" style="height: 350px;"></div>
                </div>
            </div>

        </div>
    `;

    // 2. 绑定事件
    const subjectSelect = document.getElementById('group-subject');
    const minInput = document.getElementById('group-min');
    const maxInput = document.getElementById('group-max');
    const filterBtn = document.getElementById('group-filter-btn');
    const resultsWrapper = document.getElementById('group-results-wrapper');
    const tableEl = document.getElementById('group-results-table');
    const shortcutBtns = document.querySelectorAll('.shortcut-btn');

    // 3. (新增) 快捷按钮事件
    shortcutBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const type = btn.dataset.type;
            const subject = subjectSelect.value;
            let config;
            let min = 0, max = 0;

            if (subject === 'totalScore') {
                const full = G_DynamicSubjectList.reduce((sum, key) => sum + (G_SubjectConfigs[key]?.full || 0), 0);
                const excel = G_DynamicSubjectList.reduce((sum, key) => sum + (G_SubjectConfigs[key]?.excel || 0), 0);
                const good = G_DynamicSubjectList.reduce((sum, key) => sum + (G_SubjectConfigs[key]?.good || 0), 0);
                const pass = G_DynamicSubjectList.reduce((sum, key) => sum + (G_SubjectConfigs[key]?.pass || 0), 0);
                config = { full: full, excel: excel, good: good, pass: pass };
            } else {
                config = G_SubjectConfigs[subject];
            }

            // [!!] 核心修正：从配置中读取可定义的 "良好线"
            const goodLine = config.good;

            switch (type) {
                case 'A': min = config.excel; max = config.full; break;
                case 'B': min = goodLine; max = config.excel; break;
                case 'C': min = config.pass; max = goodLine; break;
                case 'D': min = 0; max = config.pass; break;
            }

            minInput.value = Math.floor(min);
            maxInput.value = Math.ceil(max);
        });
    });

    // 4. (修改) 筛选按钮事件 (核心)
    filterBtn.addEventListener('click', () => {
        const subject = subjectSelect.value;
        const min = parseFloat(minInput.value);
        const max = parseFloat(maxInput.value);

        const filteredStudents = students.filter(s => {
            const score = (subject === 'totalScore') ? s.totalScore : s.scores[subject];
            return score >= min && score <= max;
        });

        resultsWrapper.style.display = 'block';

        // 4.1 渲染表格
        if (filteredStudents.length === 0) {
            tableEl.innerHTML = `<p>在 ${min} - ${max} 分数段内没有找到学生。</p>`;
            document.getElementById('group-class-pie-chart').innerHTML = '';
            document.getElementById('group-radar-chart').innerHTML = '';
            return;
        }

        tableEl.innerHTML = `
            <h4>筛选结果 (共 ${filteredStudents.length} 人)</h4>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>班排</th>
                            <th>姓名</th>
                            <th>考号</th>
                            <th>${subject === 'totalScore' ? '总分' : subject}</th>
                            <th>年排</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${filteredStudents.map(s => `
                        <tr>
                            <td>${s.rank}</td>
                            <td>${s.name}</td>
                            <td>${s.id}</td>
                            <td><strong>${subject === 'totalScore' ? s.totalScore : s.scores[subject]}</strong></td>
                            <td>${s.gradeRank || 'N/A'}</td>
                        </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;

        // 4.2 (新增) 渲染图表
        renderGroupClassPie('group-class-pie-chart', filteredStudents);
        renderGroupRadarChart('group-radar-chart', filteredStudents, G_Statistics);
    });
}
/**
 * (新增) 9.6. 模块六：学科关联矩阵
 */
function renderCorrelation(container, activeData) {
    // 1. 渲染基础 HTML
    container.innerHTML = `
        <h2>模块九：学科关联矩阵 (当前筛选: ${G_CurrentClassFilter})</h2>
        <div class="main-card-wrapper">
            <div class="controls-bar chart-controls">
                <h4 style="margin:0;">全科相关系数热力图</h4>
                <span style="font-size: 0.8em; color: var(--text-muted);">(1: 强正相关, -1: 强负相关)</span>
            </div>
            <div class="chart-container" id="correlation-heatmap-chart" style="width: 100%; height: 600px;"></div>
        </div>
    `;

    // 2. 调用绘图函数
    renderCorrelationHeatmap('correlation-heatmap-chart', activeData);
}

/**
 * (新增) 9.7. 模块七：学生偏科诊断
 */
function renderWeakness(container, activeData, stats) { // [!!] (新增) 接收 G_Statistics
    // 1. 渲染基础 HTML
    container.innerHTML = `
        <h2>模块十：学生偏科诊断 (当前筛选: ${G_CurrentClassFilter})</h2>
        <p style="margin-top: -20px; margin-bottom: 20px; color: var(--text-muted);">
            </p>

        <div class="main-card-wrapper" style="margin-bottom: 20px;">
            <div class="controls-bar chart-controls">
                <h4 style="margin:0;">偏科程度四象限图(右上 (高分-高偏科)：“尖子生但有短板” (重点关注)；右下 (高分-低偏科)：“学霸/全能型”；左上 (低分-高偏科)：“基础差且有极大短板”；左下 (低分-低偏科)：“基础薄弱但各科‘均衡’的差”)</h4>
            </div>
            <div class="chart-container" id="weakness-scatter-chart" style="width: 100%; height: 500px;"></div>
        </div>

        <div class="main-card-wrapper">
                    <div class="controls-bar chart-controls">
                        <h4 style="margin:0;">学生偏科诊断总表</h4>
                        <span style="font-size: 0.8em; color: var(--text-muted);">(按“最弱项偏离度”排序)</span>
                    </div>

                    <div class="controls-bar" style="background: transparent; box-shadow: none; padding: 0 0 15px 0;">
                        <label for="weakness-search">搜索学生:</label>
                        <input type="text" id="weakness-search" placeholder="输入姓名或考号...">
                    </div>

        <div class="table-container" id="weakness-table-container">
                        </div>

                    <div id="weakness-detail-container" style="margin-top: 20px; display: none;">
                        </div>
                </div>

            </div>
        `;

    // 2. (核心) 计算偏科数据
    const weaknessData = calculateWeaknessData(activeData, stats); // [!!] (修改) 传入 stats

    // 3. 渲染图表
    renderWeaknessScatter('weakness-scatter-chart', weaknessData, stats); // [!!] (修改) 传入 stats
    renderWeaknessTable('weakness-table-container', weaknessData);

    // 4. [!!] (新增) 绑定主表点击事件，用于显示详情表
    const tableContainer = document.getElementById('weakness-table-container');
    const detailContainer = document.getElementById('weakness-detail-container');

    tableContainer.addEventListener('click', (e) => {
        // (寻找被点击的行 <tr>, 必须有 data-id 属性)
        const row = e.target.closest('tr[data-id]');
        if (!row) return;

        const studentId = row.dataset.id;
        // (从原始数据中找到该学生)
        const studentData = weaknessData.find(d => String(d.student.id) === String(studentId));

        if (studentData) {
            renderWeaknessDetail(detailContainer, studentData); // 调用新函数
            detailContainer.style.display = 'block';
        }
    });
}

/**
 * (新增) 9.8. 模块八：临界生分析
 * @param {Object} container - HTML 容器
 * @param {Array} activeData - 当前已筛选的学生数据
 */
function renderBoundary(container, activeData, stats) {

    // 1. 渲染HTML
    container.innerHTML = `
        <h2>模块五：临界生分析 (当前筛选: ${G_CurrentClassFilter})</h2>
        <p style="margin-top: -20px; margin-bottom: 20px; color: var(--text-muted);">
            快速定位“差一点”就能上一个台阶的学生。(单击学生姓名可以快速查看学生各科分数！)
        </p>

        <div class="main-card-wrapper" style="margin-bottom: 20px;">
            <h4>自定义临界线筛选</h4>
            <div class="controls-bar" style="background: transparent; box-shadow: none; padding: 0; flex-wrap: wrap;">
                <label>科目:</label>
                <select id="boundary-subject" class="sidebar-select">
                    <option value="totalScore">总分</option>
                    ${G_DynamicSubjectList.map(s => `<option value="${s}">${s}</option>`).join('')}
                </select>
                <label>分数线:</label>
                <select id="boundary-line-type" class="sidebar-select">
                    <option value="excel">优秀线</option>
                    <option value="good">良好线</option>
                    <option value="pass">及格线</option>
                    <option value="average">平均分</option>
                </select>
                <label>范围 (±):</label>
                <input type="number" id="boundary-range" value="5" style="width: 60px;">
                <button id="boundary-filter-btn" class="sidebar-button">筛选</button>
            </div>
        </div>

        <div class="main-card-wrapper" style="margin-bottom: 20px;">
            <h4>快捷预设筛选</h4>
            <div class="shortcut-btn-group" style="border-top: none; padding-top: 0;">
                <button class="shortcut-btn" data-preset="high_potential">高分短板生 (总分优秀, 1科不及格)</button>
                <button class="shortcut-btn" data-preset="pass_potential">及格短板生 (总分及格, 1科不及格)</button>
                <button class="shortcut-btn" data-preset="holistic_pass">全科及格生</button>
                <button class="shortcut-btn" data-preset="holistic_excel">全科优秀生</button>
                <button class="shortcut-btn" data-preset="multi_fail">多科不及格生 (>=3科)</button>
            </div>
        </div>

        <div class="main-card-wrapper" id="boundary-results-wrapper" style="display: none;">
                <h4 id="boundary-results-title">筛选结果</h4>
                <div class="table-container" id="boundary-results-table"></div>

                <div id="boundary-detail-container" style="margin-top: 20px; display: none; border-top: 1px solid var(--border-color); padding-top: 20px;">
                    </div>
            </div>
        `;

    // 2. 绑定事件
    const subjectSelect = document.getElementById('boundary-subject');
    const lineTypeSelect = document.getElementById('boundary-line-type');
    const rangeInput = document.getElementById('boundary-range');
    const filterBtn = document.getElementById('boundary-filter-btn');
    const presetBtns = document.querySelectorAll('.shortcut-btn[data-preset]');

    const resultsWrapper = document.getElementById('boundary-results-wrapper');
    const resultsTitle = document.getElementById('boundary-results-title');
    const resultsTable = document.getElementById('boundary-results-table');

    // (辅助函数) 渲染表格
    // (辅助函数) 渲染表格
    const renderResultTable = (title, students, targetSubject) => {
        resultsTitle.innerText = title;
        resultsWrapper.style.display = 'block';

        if (!students || students.length === 0) {
            resultsTable.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding: 20px;">未找到符合条件的学生。</p>`;
            return;
        }

        // [!!] (修改) 仅当 targetSubject 不是 'totalScore' 时才添加额外列
        const isSubject = targetSubject && targetSubject !== 'totalScore';

        let targetHeaderTitle = isSubject ? `<th>${targetSubject} 分数</th>` : '';

        resultsTable.innerHTML = `
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>姓名</th>
                        <th>班级</th>
                        <th>总分</th>
                        <th>班排</th>
                        ${targetHeaderTitle}
                    </tr>
                </thead>
                <tbody>
                    ${students.map(s => `
                    <tr data-id="${s.id}"> <td data-action="show-detail" style="cursor: pointer; color: var(--primary-color); font-weight: 600;">
                                ${s.name}
                            </td>
                        <td>${s.class}</td>
                        <td>${s.totalScore}</td>
                        <td>${s.rank}</td>
                        ${isSubject ? `<td><strong>${s.scores[targetSubject] || 'N/A'}</strong></td>` : ''}
                    </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
    };

    // 3. 事件：自定义筛选
    filterBtn.addEventListener('click', () => {
        const subject = subjectSelect.value;
        const lineType = lineTypeSelect.value;
        const range = parseFloat(rangeInput.value) || 0;

        let threshold = 0;
        // [!!] (重构)
        if (lineType === 'average') {
            // (平均分逻辑: 从 stats 中读取)
            if (subject === 'totalScore') {
                threshold = stats.totalScore ? stats.totalScore.average : 0;
            } else {
                threshold = stats[subject] ? stats[subject].average : 0;
            }
        } else {
            // (原有逻辑: 从 G_SubjectConfigs 中累加)
            if (subject === 'totalScore') {
                threshold = G_DynamicSubjectList.reduce((sum, key) => sum + (G_SubjectConfigs[key] ? G_SubjectConfigs[key][lineType] : 0), 0);
            } else {
                threshold = G_SubjectConfigs[subject] ? G_SubjectConfigs[subject][lineType] : 0;
            }
        }

        const min = threshold - range;
        const max = threshold + range;

        const filteredStudents = activeData.filter(s => {
            const score = (subject === 'totalScore') ? s.totalScore : s.scores[subject];
            return score >= min && score <= max;
        });

        renderResultTable(`“${subject}” 在 “${lineTypeSelect.options[lineTypeSelect.selectedIndex].text}” ( ${threshold.toFixed(0)}分 ) ± ${range}分 的学生 (${filteredStudents.length}人)`, filteredStudents, subject);
    });

    // (辅助函数) 获取总分线
    const getTotalLine = (lineType) => {
        return G_DynamicSubjectList.reduce((sum, key) => sum + (G_SubjectConfigs[key] ? G_SubjectConfigs[key][lineType] : 0), 0);
    };

    // 4. 事件：预设筛选
    presetBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const preset = btn.dataset.preset;
            let title = '';
            let filteredStudents = [];

            const totalPassLine = getTotalLine('pass');
            const totalExcelLine = getTotalLine('excel');

            if (preset === 'holistic_pass') {
                title = '全科及格生';
                filteredStudents = activeData.filter(s => {
                    return G_DynamicSubjectList.every(subject => {
                        const passLine = G_SubjectConfigs[subject] ? G_SubjectConfigs[subject].pass : 0;
                        return (s.scores[subject] || 0) >= passLine;
                    });
                });
            } else if (preset === 'pass_potential' || preset === 'high_potential') {
                const minTotal = (preset === 'pass_potential') ? totalPassLine : totalExcelLine;
                title = (preset === 'pass_potential') ? '及格短板生 (总分及格, 1科不及格)' : '高分短板生 (总分优秀, 1科不及格)';

                filteredStudents = activeData.filter(s => {
                    if (s.totalScore < minTotal) return false;

                    let failCount = 0;
                    G_DynamicSubjectList.forEach(subject => {
                        const passLine = G_SubjectConfigs[subject] ? G_SubjectConfigs[subject].pass : 0;
                        if ((s.scores[subject] || 0) < passLine) {
                            failCount++;
                        }
                    });
                    return failCount === 1; // [!!] 严格限制为只有1科不及格
                });
            } else if (preset === 'holistic_excel') {
                title = '全科优秀生';
                filteredStudents = activeData.filter(s => {
                    return G_DynamicSubjectList.every(subject => {
                        const excelLine = G_SubjectConfigs[subject] ? G_SubjectConfigs[subject].excel : 0;
                        return (s.scores[subject] || 0) >= excelLine;
                    });
                });

                // [!!] (新增)
            } else if (preset === 'multi_fail') {
                title = '多科不及格生 (>=3科)';
                filteredStudents = activeData.filter(s => {
                    let failCount = 0;
                    G_DynamicSubjectList.forEach(subject => {
                        const passLine = G_SubjectConfigs[subject] ? G_SubjectConfigs[subject].pass : 0;
                        if ((s.scores[subject] === null || s.scores[subject] === undefined) || s.scores[subject] < passLine) {
                            failCount++;
                        }
                    });
                    return failCount >= 3;
                });
            }
            renderResultTable(`${title} (${filteredStudents.length}人)`, filteredStudents, null);
        });
    });
    // [!!] (新增) 为结果表添加点击事件
    const detailContainer = document.getElementById('boundary-detail-container');

    resultsTable.addEventListener('click', (e) => {
        // (寻找被点击的 <td> 单元格)
        const cell = e.target.closest('td[data-action="show-detail"]');
        // (寻找被点击的 <tr> 行)
        const row = e.target.closest('tr[data-id]');

        if (!cell || !row) return; // 必须点击在指定单元格上

        const studentId = row.dataset.id;
        const student = activeData.find(s => String(s.id) === String(studentId));

        if (student) {
            // (调用新函数渲染详情)
            renderBoundaryStudentDetail(detailContainer, student);
            detailContainer.style.display = 'block';
        }
    });
}



/**
 * (新增) 9.9. 模块九：全科均衡分析
 * @param {Object} container - HTML 容器
 * @param {Array} activeData - 当前已筛选的学生数据
 * @param {Object} stats - G_Statistics
 */
function renderHolisticBalance(container, activeData, stats) {

    // 1. 渲染HTML
    container.innerHTML = `
        <h2>模块：全科均衡分析 (当前筛选: ${G_CurrentClassFilter})</h2>
        <p style="margin-top: -20px; margin-bottom: 20px; color: var(--text-muted);">
            分析学生群体的“短板”数量分布。点击下方柱状图可查看学生列表。
        </p>

        <div class="main-card-wrapper" style="margin-bottom: 20px;">
            <h4 style="margin:0;">不及格科目数量分布</h4>
            <div class="chart-container" id="holistic-failure-count-chart" style="height: 500px;"></div>
        </div>

        <div class="main-card-wrapper" id="holistic-results-wrapper" style="display: none;">
            <h4 id="holistic-results-title">学生列表</h4>
            <div class="table-container" id="holistic-results-table"></div>
        </div>
    `;

    // 2. (核心) [!!] (修改) 计算不及格科目数, 并存储学生对象
    const failureData = {}; // { 0: [student1, student2], 1: [student3], ... }

    activeData.forEach(student => {
        let count = 0;
        G_DynamicSubjectList.forEach(subject => {
            const passLine = G_SubjectConfigs[subject] ? G_SubjectConfigs[subject].pass : 0;
            if ((student.scores[subject] === null || student.scores[subject] === undefined) || student.scores[subject] < passLine) {
                count++; // (缺考也算不及格)
            }
        });

        if (!failureData[count]) {
            failureData[count] = [];
        }
        failureData[count].push(student); // [!!] (修改) 存入学生对象
    });

    // 3. [!!] (修改) 渲染图表, 并获取 ECharts 实例
    const chartInstance = renderFailureCountChart('holistic-failure-count-chart', failureData);

    // 4. [!!] (新增) 绑定图表点击事件
    const resultsWrapper = document.getElementById('holistic-results-wrapper');
    const resultsTitle = document.getElementById('holistic-results-title');
    const resultsTable = document.getElementById('holistic-results-table');

    if (chartInstance) {
        chartInstance.on('click', (params) => {
            const failCountText = params.name; // '0 科', '1 科', ...
            const countKey = failCountText.split(' ')[0]; // '0', '1', ...
            const students = failureData[countKey];

            if (!students || students.length === 0) return;

            resultsWrapper.style.display = 'block';
            resultsTitle.innerText = `不及格 ${failCountText} 的学生 (${students.length}人)`;

            // (渲染学生列表)
            resultsTable.innerHTML = `
                <div class="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>姓名</th>
                                <th>班级</th>
                                <th>总分</th>
                                <th>班排</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${students.map(s => `
                            <tr>
                                <td>${s.name}</td>
                                <td>${s.class}</td>
                                <td>${s.totalScore}</td>
                                <td>${s.rank}</td>
                            </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        });
    }
}

/**
 * (新增) 9.10. 模块十：成绩分布变动
 * @param {Object} container - HTML 容器
 * @param {Array} currentData - (已筛选) 本次学生数据
 * @param {Array} compareData - (已筛选) 对比学生数据
 * @param {Object} currentStats - G_Statistics
 * @param {Object} compareStats - G_CompareStatistics
 */
/**
 * (新增) 9.10. 模块十：成绩分布变动
 * [!!] (完整修复版)
 */
function renderTrendDistribution(container, currentData, compareData, currentStats, compareStats, currentFilter) {

    // 1. 检查是否有对比数据
    if (!compareData || compareData.length === 0) {
        container.innerHTML = `<h2>模块：成绩分布变동</h2><p>请先在侧边栏导入 "对比成绩" 数据。</p>`;
        return;
    }

    // 2. 渲染HTML
    container.innerHTML = `
        <h2>模块：成绩分布变动 (当前筛选: ${G_CurrentClassFilter})</h2>
        <p style="margin-top: -20px; margin-bottom: 20px; color: var(--text-muted);">
            对比两次考试的“群体形态”变化。
        </p>

        <div class="main-card-wrapper" style="margin-bottom: 20px;">
            <div class="controls-bar chart-controls">
                <label for="dist-subject-select">选择科目:</label>
                <select id="dist-subject-select" class="sidebar-select">
                    <option value="totalScore">总分</option>
                    ${G_DynamicSubjectList.map(s => `<option value="${s}">${s}</option>`).join('')}
                </select>
            </div>
            <div class="chart-container" id="dist-overlap-histogram-chart" style="height: 500px;"></div>
        </div>

        <div class="main-card-wrapper">
            <h4 style="margin:0;">总分排名分层流动图 (桑基图)</h4>
            <p style="color: var(--text-muted); font-size: 0.9em; margin-top: 0;">
                点击图中的“节点”或“流向”可查看学生列表。(绿色表示向上流动，红色表示向下流动)
            </p>
            <div class="chart-container" id="dist-sankey-chart" style="height: 600px;"></div>
        </div>

        <div class="main-card-wrapper" id="dist-sankey-results-wrapper" style="display: none; margin-top: 20px;">
            <h4 id="dist-sankey-results-title">学生列表</h4>
            <div class="table-container" id="dist-sankey-results-table"></div>
        </div>
    `;

    // 3. 匹配两个数据源 (包含 oldGradeRank)
    const mergedData = currentData.map(student => {
        const oldStudent = compareData.find(s => String(s.id) === String(student.id));
        if (!oldStudent) return null;

        return {
            ...student,
            oldTotalScore: oldStudent.totalScore,
            oldRank: oldStudent.rank,
            oldGradeRank: oldStudent.gradeRank || 0
        };
    }).filter(s => s !== null);


    // 4. 绑定直方图事件
    const subjectSelect = document.getElementById('dist-subject-select');

    const drawHistogram = () => {
        const subject = subjectSelect.value;
        const currentScores = (subject === 'totalScore')
            ? currentData.map(s => s.totalScore)
            : currentData.map(s => s.scores[subject]);

        const compareScores = (subject === 'totalScore')
            ? compareData.map(s => s.totalScore)
            : compareData.map(s => s.scores[subject]);

        renderOverlappingHistogram('dist-overlap-histogram-chart', currentScores, compareScores, subject);
    };

    subjectSelect.addEventListener('change', drawHistogram);

    // 5. 将分层逻辑移到此处，以便共享
    const total = currentData.length;
    const rankTiers = [
        { name: 'Top 10%', min: 1, max: Math.ceil(total * 0.1) },
        { name: '10%-30%', min: Math.ceil(total * 0.1) + 1, max: Math.ceil(total * 0.3) },
        { name: '30%-60%', min: Math.ceil(total * 0.3) + 1, max: Math.ceil(total * 0.6) },
        { name: 'Bottom 40%', min: Math.ceil(total * 0.6) + 1, max: total }
    ];

    // (辅助函数)
    const getRankCategory = (rank) => {
        for (const tier of rankTiers) {
            if (rank >= tier.min && rank <= tier.max) {
                return tier.name;
            }
        }
        return 'N/A';
    };

    // 6. 初始绘制
    drawHistogram();

    // 7. [!!] (修复) 确保
    // (A) 变量定义
    // (B) 查找元素
    // (C) IF 语句
    // ...按此顺序执行

    // (A) 定义变量
    const sankeyInstance = renderRankingSankey('dist-sankey-chart', mergedData, rankTiers, getRankCategory, currentFilter);

    // (B) 查找表格元素
    const resultsWrapper = document.getElementById('dist-sankey-results-wrapper');
    const resultsTitle = document.getElementById('dist-sankey-results-title');
    const resultsTable = document.getElementById('dist-sankey-results-table');

    // (C) 使用变量 (IF 语句)
    if (sankeyInstance) {
        sankeyInstance.on('click', (params) => {
            let students = [];
            let title = '';
            let tableHtml = '';

            const { dataType, data } = params;

            // (核心修复) 检查当前是否为年段模式
            const useGradeRank = (currentFilter === 'ALL');

            // (辅助函数) 获取分层索引
            const getTierIndex = (tierName) => rankTiers.findIndex(t => t.name === tierName);

            if (dataType === 'link') {
                // --- 1. 点击了 "流向" ---
                title = `${data.source} → ${data.target} (${data.value}人)`;
                const sourceTierName = data.source.replace('上次: ', '');
                const targetTierName = data.target.replace('本次: ', '');

                students = mergedData.filter(s => {
                    // (修复) 动态选择排名
                    const oldRank = useGradeRank ? (s.oldGradeRank || 0) : s.oldRank;
                    const newRank = useGradeRank ? (s.gradeRank || 0) : s.rank;

                    return oldRank > 0 && newRank > 0 &&
                        getRankCategory(oldRank) === sourceTierName &&
                        getRankCategory(newRank) === targetTierName;
                });

                // (判断流动方向)
                const oldIndex = getTierIndex(sourceTierName);
                const newIndex = getTierIndex(targetTierName);
                let rowClass = '';
                if (oldIndex > newIndex) rowClass = 'progress'; // 进步
                if (oldIndex < newIndex) rowClass = 'regress'; // 退步

                // (修复) 动态表头
                const newRankHeader = useGradeRank ? '本次年排' : '本次班排';
                const oldRankHeader = useGradeRank ? '上次年排' : '上次班排';

                tableHtml = `
                    <thead>
                        <tr><th>姓名</th><th>班级</th><th>本次总分</th><th>${newRankHeader}</th><th>上次总分</th><th>${oldRankHeader}</th></tr>
                    </thead>
                    <tbody>
                        ${students.map(s => `
                        <tr class="${rowClass}">
                            <td>${s.name}</td>
                            <td>${s.class}</td>
                            <td>${s.totalScore}</td>
                            <td>${useGradeRank ? (s.gradeRank || 0) : s.rank}</td>
                            <td>${s.oldTotalScore}</td>
                            <td>${useGradeRank ? (s.oldGradeRank || 0) : s.oldRank}</td>
                        </tr>
                        `).join('')}
                    </tbody>
                `;

            } else if (dataType === 'node') {
                // --- 2. 点击了 "节点" ---
                title = `${params.name} (${params.value}人)`;

                const nodeName = data.name.replace('上次: ', '').replace('本次: ', '');
                const isOld = data.name.startsWith('上次:');

                students = mergedData.filter(s => {
                    // (核心修复) 动态选择排名
                    const rank = isOld
                        ? (useGradeRank ? (s.oldGradeRank || 0) : s.oldRank)
                        : (useGradeRank ? (s.gradeRank || 0) : s.rank);
                    return rank > 0 && getRankCategory(rank) === nodeName;
                });

                // (修复) 动态表头
                const newRankHeader = useGradeRank ? '本次年排' : '本次班排';
                const oldRankHeader = useGradeRank ? '上次年排' : '上次班排';

                tableHtml = `
                <thead>
                    <tr>
                        <th>姓名</th>
                        <th>班级</th>
                        <th>${newRankHeader}</th>
                        <th>${oldRankHeader}</th>
                        <th>上次分层</th>
                        <th>本次分层</th> </tr>
                </thead>
                <tbody>
                    ${students.map(s => {
                    // (修复) 动态选择排名
                    const oldRank = useGradeRank ? (s.oldGradeRank || 0) : s.oldRank;
                    const newRank = useGradeRank ? (s.gradeRank || 0) : s.rank;

                    const oldTierName = oldRank > 0 ? getRankCategory(oldRank) : 'N/A';
                    const newTierName = newRank > 0 ? getRankCategory(newRank) : nodeName;

                    const oldIndex = getTierIndex(oldTierName);
                    const newIndex = getTierIndex(newTierName);
                    let rowClass = '';
                    if (oldIndex > newIndex && oldIndex !== -1 && newIndex !== -1) {
                        rowClass = 'progress';
                    } else if (oldIndex < newIndex && oldIndex !== -1 && newIndex !== -1) {
                        rowClass = 'regress';
                    }

                    return `
                        <tr class="${rowClass}">
                            <td>${s.name}</td>
                            <td>${s.class}</td>
                            <td>${newRank}</td>
                            <td>${oldRank}</td>
                            <td>${oldTierName}</td>
                            <td>${newTierName}</td> </tr>
                        `;
                }).join('')}
                </tbody>
            `;
            }

            if (students.length > 0) {
                resultsWrapper.style.display = 'block';
                resultsTitle.innerText = title;
                // 渲染表格
                resultsTable.innerHTML = `
                    <div class="table-container">
                        <table>
                            ${tableHtml}
                        </table>
                    </div>
                `;
            }
        });
    }
}

/**
 * (新增) 9.11. 模块十二：多次考试分析
 * [!!] (重构) 新增“导入/导出 JSON 备份”功能
 * @param {Object} container - HTML 容器
 */
function renderMultiExam(container) {

    // 1. 渲染模块独有的HTML (包含独立的文件上传器)
    container.innerHTML = `
        <h2>模块十二：多次考试分析</h2>
        <p style="margin-top: -20px; margin-bottom: 20px; color: var(--text-muted);">
            在此模块上传的成绩将被浏览器永久保存（直到您手动清除）。
        </p>

        <div class="main-card-wrapper" style="margin-bottom: 20px;">
            <h4>考试列表管理</h4>

            <ol id="multi-exam-list" class="multi-exam-list-container"></ol>

            <div class="controls-bar" style="background: transparent; box-shadow: none; padding: 15px 0 0 0; border-top: 1px solid var(--border-color); flex-wrap: wrap; justify-content: space-between;">

                <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                    <label for="multi-file-uploader" class="upload-label" style="padding: 10px 16px; background-color: var(--primary-color); color: white;">
                        📊 添加新成绩 (可多选)
                    </label>
                    <input type="file" id="multi-file-uploader" accept=".xlsx, .xls, .csv" style="display: none;" multiple>

                    <label for="multi-json-uploader" class="upload-label" style="padding: 10px 16px; background-color: var(--color-orange); color: white;">
                        📥 导入备份 (JSON)
                    </label>
                    <input type="file" id="multi-json-uploader" accept=".json" style="display: none;">
                </div>

                <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                    <button id="multi-export-all" class="sidebar-button" style="background-color: var(--color-green);">
                        📤 导出备份 (JSON)
                    </button>
                    <button id="multi-clear-all" class="sidebar-button" style="background-color: var(--color-red);">
                        🗑️ 清除全部
                    </button>
                </div>
            </div>
            <span id="multi-file-status" style="margin-top: 10px; color: var(--text-muted); display: block;"></span>
        </div>

        <div class="main-card-wrapper" style="margin-bottom: 20px;">
            <div class="controls-bar">
                <label for="multi-student-search">搜索学生 (姓名/考号):</label>
                <div class="search-combobox">
                    <input type="text" id="multi-student-search" placeholder="输入姓名或考号..." autocomplete="off">
                    <div class="search-results" id="multi-student-search-results"></div>
                </div>
            </div>
        </div>

        <div id="multi-student-report" style="display: none;">
            <div class="main-card-wrapper" style="margin-bottom: 20px;">
                <h4 id="multi-student-name-title">学生报表</h4>
                <div id="multi-subject-filter-container">
                    <div class="main-card-wrapper" style="padding: 15px; margin-top: 10px; box-shadow: var(--shadow-sm);">
                        <h5>各科成绩曲线 (图1) - 科目筛选</h5>
                        <div class="controls-bar" style="background: transparent; box-shadow: none; padding: 0; flex-wrap: wrap; gap: 10px;">
                            <button id="multi-subject-all" class="sidebar-button" style="padding: 5px 10px; font-size: 0.8em;">全选</button>
                            <button id="multi-subject-none" class="sidebar-button" style="padding: 5px 10px; font-size: 0.8em; background-color: var(--color-gray);">全不选</button>
                        </div>
                        <div id="multi-subject-checkboxes" class="multi-subject-filter-container">
                        </div>
                    </div>
                </div>
                <div class="dashboard-chart-grid-1x1" style="margin-top: 20px;">
                    <div class="chart-container" id="multi-exam-score-chart" style="height: 400px;"></div>
                    <div class="chart-container" id="multi-exam-rank-chart" style="height: 400px;"></div>
                </div>
                <div id="multi-student-table-container" class="multi-exam-table-container">
                </div>
            </div>
        </div>
    `;

    // 2. 绑定 DOM 和事件
    const multiUploader = document.getElementById('multi-file-uploader');
    const statusLabel = document.getElementById('multi-file-status');
    const listContainer = document.getElementById('multi-exam-list');
    const clearBtn = document.getElementById('multi-clear-all');

    // [!!] (新增) 绑定导入/导出按钮
    const exportBtn = document.getElementById('multi-export-all');
    const jsonUploader = document.getElementById('multi-json-uploader');


    // (上传事件 - 不变)
    multiUploader.addEventListener('change', async (event) => {
        const files = event.target.files;
        if (!files || files.length === 0) return;

        statusLabel.innerText = `🔄 正在解析 ${files.length} 个文件...`;
        let loadedData = loadMultiExamData(); // (获取现有数据)

        try {
            for (const file of files) {
                const { processedData } = await loadExcelData(file);
                const rankedData = addSubjectRanksToData(processedData);

                loadedData.push({
                    id: Date.now() + Math.random(),
                    originalName: file.name,
                    label: file.name.replace(/\.xlsx|\.xls|\.csv/g, ''),
                    students: rankedData
                });
            }

            statusLabel.innerText = `✅ 成功添加 ${files.length} 次考试。`;
            saveMultiExamData(loadedData);
            renderMultiExamList(loadedData);
            initializeStudentSearch(loadedData);

        } catch (err) {
            statusLabel.innerText = `❌ 加载失败: ${err.message}`;
            console.error(err);
        }
    });

    // (列表交互事件 - 不变)
    listContainer.addEventListener('input', (e) => {
        if (e.target && e.target.dataset.role === 'label') {
            const id = e.target.closest('li').dataset.id;
            const newLabel = e.target.value;
            let data = loadMultiExamData();
            const item = data.find(d => String(d.id) === id);
            if (item) {
                item.label = newLabel;
                saveMultiExamData(data);
                initializeStudentSearch(data);
                document.getElementById('multi-student-report').style.display = 'none';
            }
        }
    });
    listContainer.addEventListener('click', (e) => {
        // ... (此函数内部不变) ...
        if (!e.target) return;
        const button = e.target.closest('button');
        if (!button) return;

        const role = button.dataset.role;
        const id = button.closest('li').dataset.id;
        let data = loadMultiExamData();
        const index = data.findIndex(d => String(d.id) === id);

        if (index === -1) return;

        if (role === 'delete') {
            data.splice(index, 1);
        } else if (role === 'up' && index > 0) {
            [data[index - 1], data[index]] = [data[index], data[index - 1]]; // (交换)
        } else if (role === 'down' && index < data.length - 1) {
            [data[index + 1], data[index]] = [data[index], data[index + 1]]; // (交换)
        }

        saveMultiExamData(data);
        renderMultiExamList(data);
        initializeStudentSearch(data);
        document.getElementById('multi-student-report').style.display = 'none';
    });

    // (清空事件 - 不变)
    clearBtn.addEventListener('click', () => {
        if (confirm('您确定要清除所有已保存的“多次考试”数据吗？此操作不可撤销。')) {
            saveMultiExamData([]);
            renderMultiExamList([]);
            initializeStudentSearch([]);
            document.getElementById('multi-student-report').style.display = 'none';
        }
    });

    // [!!] (新增) 导出备份 (Export JSON)
    exportBtn.addEventListener('click', () => {
        const data = loadMultiExamData();
        if (data.length === 0) {
            alert('没有可导出的数据。');
            return;
        }
        try {
            const jsonString = JSON.stringify(data);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = `成绩分析系统_多次考试备份_${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            statusLabel.innerText = `✅ 成功导出 ${data.length} 条考试数据。`;
        } catch (err) {
            statusLabel.innerText = `❌ 导出失败: ${err.message}`;
            console.error(err);
        }
    });

    // [!!] (新增) 导入备份 (Import JSON)
    jsonUploader.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;

        statusLabel.innerText = `🔄 正在读取备份文件...`;
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const importedData = JSON.parse(e.target.result);

                // (简单校验)
                if (!Array.isArray(importedData) || (importedData.length > 0 && !importedData[0].students)) {
                    throw new Error('文件格式不正确，不是有效的备份文件。');
                }

                if (confirm(`您确定要用此文件中的 ${importedData.length} 条数据，覆盖当前所有“多次考试”数据吗？`)) {
                    saveMultiExamData(importedData);
                    renderMultiExamList(importedData);
                    initializeStudentSearch(importedData);
                    document.getElementById('multi-student-report').style.display = 'none';
                    statusLabel.innerText = `✅ 成功导入 ${importedData.length} 条考试数据。`;
                } else {
                    statusLabel.innerText = '导入操作已取消。';
                }

            } catch (err) {
                statusLabel.innerText = `❌ 导入失败: ${err.message}`;
                console.error(err);
            } finally {
                jsonUploader.value = null; // (清空 input，以便下次还能选择同名文件)
            }
        };

        reader.onerror = () => {
            statusLabel.innerText = '❌ 文件读取失败。';
            jsonUploader.value = null;
        };

        reader.readAsText(file);
    });

    // 3. (核心) 页面加载时, 立即加载数据并渲染 (不变)
    const initialData = loadMultiExamData();
    renderMultiExamList(initialData);
    initializeStudentSearch(initialData);
}
/**
 * (新增) 10.15. 渲染学科关联热力图 (Heatmap)
 * [!!] (已修复)
 */
function renderCorrelationHeatmap(elementId, activeData) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    // 1. (核心) 计算相关系数矩阵
    const subjects = G_DynamicSubjectList; // (已确认正确)
    const n = subjects.length;
    const heatmapData = []; // ECharts 格式: [xIndex, yIndex, value]
    const correlationMatrix = Array(n).fill(0).map(() => Array(n).fill(0));

    // (提取所有科目的分数数组，提高效率)
    // (此 scoresMap 未在此函数中使用, 但保留无害)
    const scoresMap = {};
    subjects.forEach(subject => {
        scoresMap[subject] = activeData.map(s => s.scores[subject]).filter(s => s !== null && s !== undefined);
    });

    // [!!] (逻辑修复)
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {

            let value = 0.0; // (默认值)

            if (i === j) {
                value = 1.0;
                correlationMatrix[i][j] = value;

            } else if (i < j) {
                // (只计算上三角)
                const xSubject = subjects[i];
                const ySubject = subjects[j];

                // (对齐学生)
                const xScores = [];
                const yScores = [];
                activeData.forEach(student => {
                    const xScore = student.scores[xSubject];
                    const yScore = student.scores[ySubject];
                    if (xScore !== null && yScore !== null && xScore !== undefined && yScore !== undefined) {
                        xScores.push(xScore);
                        yScores.push(yScore);
                    }
                });

                const coeff = calculateCorrelation(xScores, yScores);
                value = coeff;
                correlationMatrix[i][j] = value;
                correlationMatrix[j][i] = value; // (矩阵对称)

            } else { // (i > j)
                // [!!] (核心修复)
                // (我们不重新计算, 而是从已存的对称矩阵中检索值)
                value = correlationMatrix[i][j];
            }

            // (现在, push 逻辑在所有分支之后执行, 确保 value 是正确的)
            heatmapData.push([
                i, // X 轴索引
                j, // Y 轴索引
                parseFloat(value.toFixed(2)) // 值
            ]);
        }
    }

    // 2. ECharts 配置 (不变)
    const option = {
        title: {
            text: '学科相关性热力图',
            left: 'center',
            textStyle: { fontSize: 16, fontWeight: 'normal' }
        },
        tooltip: {
            position: 'top',
            formatter: (params) => {
                const i = params.data[0];
                const j = params.data[1];
                const value = params.data[2];
                return `<strong>${subjects[i]}</strong> vs <strong>${subjects[j]}</strong><br/>` +
                    `相关系数: <strong>${value}</strong>`;
            }
        },
        grid: {
            height: '70%',
            top: '10%',
            bottom: '20%'
        },
        xAxis: {
            type: 'category',
            data: subjects,
            splitArea: { show: true },
            axisLabel: { rotate: 30 }
        },
        yAxis: {
            type: 'category',
            data: subjects,
            splitArea: { show: true }
        },
        visualMap: {
            min: -1,
            max: 1,
            calculable: true,
            orient: 'horizontal',
            left: 'center',
            bottom: '5%',
            inRange: {
                color: ['#dc3545', '#ffffff', '#007bff']
            }
        },
        series: [{
            name: '相关系数',
            type: 'heatmap',
            data: heatmapData,
            label: {
                show: true,
                formatter: (params) => params.data[2]
            },
            emphasis: {
                itemStyle: {
                    shadowBlur: 10,
                    shadowColor: 'rgba(0, 0, 0, 0.5)'
                }
            }
        }]
    };

    echartsInstances[elementId].setOption(option);
}

// ---------------------------------
// 10. ECharts 绘图函数
// ---------------------------------
/**
 * 10.1. 渲染直方图 (Histogram)
 * [!!] 修复了 "effectiveBinSize is not defined" 的引用错误
 * [!!] 高亮最大值和最小值的柱子
 * [!!] Tooltip 中显示学生姓名
 */
function renderHistogram(elementId, students, scoreKey, fullScore, title, binSize) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    // 检查是否有有效分数
    if (!students || students.length === 0) {
        chartDom.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding-top: 50px;">无数据可供显示。</p>`;
        return;
    }

    // 1. (新增) 从学生数据中提取分数
    const scores = students.map(s => {
        const score = (scoreKey === 'totalScore') ? s.totalScore : s.scores[scoreKey];
        return (typeof score === 'number' && !isNaN(score)) ? score : null;
    }).filter(s => s !== null).sort((a, b) => a - b);

    if (scores.length === 0) {
        chartDom.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding-top: 50px;">无有效分数数据。</p>`;
        return;
    }

    // [!!] 核心修正：effectiveBinSize 必须在这里定义
    const effectiveBinSize = binSize > 0 ? binSize : Math.max(10, Math.ceil(fullScore / 10));

    // 2. X轴截断逻辑 (现在可以正常工作了)
    const minScore = scores[0];
    const maxScore = scores[scores.length - 1];
    const startBin = Math.floor(minScore / effectiveBinSize) * effectiveBinSize;
    const endBinLimit = Math.min(Math.ceil((maxScore + 0.01) / effectiveBinSize) * effectiveBinSize, fullScore);

    // 3. (修改) 动态生成分数段 (bins)
    const bins = {};
    let labels = [];

    for (let i = startBin; i < endBinLimit; i += effectiveBinSize) {
        const end = Math.min(i + effectiveBinSize, fullScore);
        const label = `${i}-${end}`;
        bins[label] = [];
        labels.push(label);
    }

    // 4. (修改) 填充数据
    students.forEach(student => {
        const score = (scoreKey === 'totalScore') ? student.totalScore : student.scores[scoreKey];
        if (typeof score !== 'number' || isNaN(score) || score < startBin) return;

        if (score === fullScore) {
            const lastLabel = labels[labels.length - 1];
            if (bins[lastLabel] !== undefined) bins[lastLabel].push(student.name);
        } else {
            const binIndex = Math.floor((score - startBin) / effectiveBinSize);
            if (labels[binIndex] && bins.hasOwnProperty(labels[binIndex])) {
                bins[labels[binIndex]].push(student.name);
            }
        }
    });

    // 5. (修改) 准备 ECharts Series 数据
    // (先找出最大/最小值，用于高亮)
    let maxValue = -Infinity;
    let minValue = Infinity;
    const counts = labels.map(label => (bins[label] || []).length);

    const validCounts = counts.filter(v => v > 0);
    if (validCounts.length > 0) {
        minValue = Math.min(...validCounts);
    } else {
        minValue = 0;
    }
    maxValue = Math.max(...counts);

    // (构建 Series Data)
    const seriesData = labels.map(label => {
        const studentNames = bins[label] || [];
        const count = studentNames.length;

        let color;
        if (count === maxValue && maxValue !== 0) {
            color = '#28a745'; // Green
        } else if (count === minValue && minValue !== maxValue) {
            color = '#dc3545'; // Red
        } else {
            color = '#007bff'; // Blue (Default)
        }

        return {
            value: count,
            names: studentNames,
            itemStyle: { color: color } // [!!] (新增)
        };
    });

    const option = {
        title: { text: title, left: 'center', textStyle: { fontSize: 16, fontWeight: 'normal' } },
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            formatter: (params) => {
                const param = params[0];
                const data = param.data;
                const binLabel = param.name;
                const count = data.value;
                const names = data.names;

                if (count === 0) {
                    return `<strong>${binLabel}</strong><br/>人数: 0`;
                }

                let namesHtml = names.slice(0, 10).join('<br/>');
                if (names.length > 10) {
                    namesHtml += `<br/>... (及另外 ${names.length - 10} 人)`;
                }

                return `<strong>${binLabel}</strong><br/>` +
                    `<strong>人数: ${count}</strong><hr style="margin: 5px 0; border-color: #eee;"/>` +
                    `${namesHtml}`;
            }
        },
        grid: { left: '3%', right: '4%', bottom: '20%', containLabel: true },
        xAxis: {
            type: 'category',
            data: labels,
            name: '分数段',
            axisLabel: {
                interval: 'auto',
                rotate: labels.length > 10 ? 30 : 0
            }
        },
        yAxis: { type: 'value', name: '学生人数' },
        series: [{
            name: '人数',
            type: 'bar',
            data: seriesData
        }],
        toolbox: {
            show: true,
            feature: {
                saveAsImage: { show: true, title: '保存为图片' }
            }
        }
    };
    echartsInstances[elementId].setOption(option);
}

/**
 * 10.2. 渲染雷达图 (Radar)
 * @param {string} elementId - DOM 元素 ID
 * @param {Object} stats - G_Statistics 对象
 */
function renderAverageRadar(elementId, stats) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    const indicators = G_DynamicSubjectList.map(subject => {
        const full = G_SubjectConfigs[subject]?.full || 100;
        return { name: subject, max: full }; // (新增) max 动态读取配置
    });

    const averageData = G_DynamicSubjectList.map(subject => {
        return stats[subject] ? stats[subject].average : 0;
    });

    const option = {
        title: { text: '各科平均分雷达图', left: 'center' },
        tooltip: { trigger: 'item' },
        radar: {
            indicator: indicators,
            radius: 120, // 雷达图大小
        },
        series: [{
            name: '班级平均分',
            type: 'radar',
            data: [{ value: averageData, name: '平均分' }]
        }]
    };
    echartsInstances[elementId].setOption(option);
}

/**
 * 10.3. 渲染科目对比条形图 (已重构，移除排序)
 * [!!] 已修改：高亮显示最大值和最小值
 * [!!] 已修改：标签格式化为 2 位小数
 */
function renderSubjectComparisonBarChart(elementId, stats, metric) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    // 1. 提取数据
    const data = G_DynamicSubjectList.map(subject => {
        return {
            name: subject,
            value: (stats[subject] && stats[subject][metric] !== undefined) ? stats[subject][metric] : 0
        };
    });

    // 2. 准备ECharts数据
    const labels = data.map(d => d.name);
    const values = data.map(d => d.value);

    // [!!] (新增) 找出最大值和最小值
    let maxValue = -Infinity;
    let minValue = Infinity;
    // (过滤掉 0 或无效值来找最小值，除非全是0)
    const validValues = values.filter(v => v > 0);
    if (validValues.length > 0) {
        minValue = Math.min(...validValues);
    } else {
        minValue = 0; // 如果都是0，最小值就是0
    }
    maxValue = Math.max(...values);

    // [!!] (新增) 准备 Series 数据，用于高亮
    const seriesData = values.map(value => {
        let color;
        if (value === maxValue && maxValue !== 0) {
            color = '#28a745'; // Green
        } else if (value === minValue && minValue !== maxValue) {
            color = '#dc3545'; // Red
        } else {
            color = '#007bff'; // Blue (Default)
        }
        return {
            value: value,
            itemStyle: { color: color }
        };
    });


    // 4. 根据指标确定图表标题
    let titleText = '';
    switch (metric) {
        case 'average': titleText = '各科平均分对比'; break;
        case 'passRate': titleText = '各科及格率对比 (%)'; break;
        case 'excellentRate': titleText = '各科优秀率对比 (%)'; break;
        case 'stdDev': titleText = '各科标准差对比'; break;
        case 'max': titleText = '各科最高分对比'; break;
        case 'difficulty': titleText = '各科难度系数对比'; break;
        default: titleText = '科目对比';
    }

    const option = {
        title: { text: titleText, left: 'center', textStyle: { fontSize: 16, fontWeight: 'normal' } },
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
        grid: { left: '3%', right: '8%', bottom: '3%', containLabel: true },
        xAxis: { type: 'category', data: labels, name: '科目', axisLabel: { rotate: 30 } },
        yAxis: { type: 'value', name: metric.includes('Rate') ? '%' : '分数' },
        series: [{
            name: titleText,
            type: 'bar',
            data: seriesData, // [!!] 使用新的 seriesData
            barWidth: '60%',
            label: {
                show: true,
                position: 'top',
                formatter: (params) => parseFloat(params.value).toFixed(2)
            }
        }],
        toolbox: {
            show: true,
            feature: {
                saveAsImage: { show: true, title: '保存为图片' }
            }
        }
    };
    echartsInstances[elementId].setOption(option);
}

/**
 * (新增) 10.4. 渲染班级对比条形图
 * [!!] 已修改：高亮显示最大值(绿色)和最小值(红色)
 */
function renderClassComparisonChart(elementId, data, title) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    // [!!] (修改) 找出最大值和最小值
    let maxValue = -Infinity;
    let minValue = Infinity;
    const values = data.map(d => d.value);

    const validValues = values.filter(v => v > 0);
    if (validValues.length > 0) {
        minValue = Math.min(...validValues);
    } else {
        minValue = 0;
    }
    maxValue = Math.max(...values);


    // 2. 准备 ECharts 数据
    const labels = data.map(d => d.name);

    // [!!] (修改) 将 'values' 数组转换为包含自定义样式的 'seriesData' 数组
    const seriesData = data.map(d => {
        const isMax = (d.value === maxValue && maxValue !== 0);
        const isMin = (d.value === minValue && minValue !== maxValue);

        let color;
        if (isMax) {
            color = '#28a745'; // Green
        } else if (isMin) {
            color = '#dc3545'; // Red
        } else {
            color = '#007bff'; // Blue (Default)
        }

        return {
            value: d.value,
            itemStyle: { color: color }
        };
    });


    const option = {
        title: { text: title, left: 'center', textStyle: { fontSize: 16, fontWeight: 'normal' } },
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
        grid: { left: '3%', right: '8%', bottom: '3%', containLabel: true },
        xAxis: {
            type: 'category',
            data: labels,
            name: '班级',
            axisLabel: {
                interval: 0,
                rotate: 30
            }
        },
        yAxis: { type: 'value', name: '数值' },
        series: [{
            name: title,
            type: 'bar',
            data: seriesData, // [!!] (修改) 使用新的 seriesData
            barWidth: '60%',
            label: {
                show: true,
                position: 'top',
                formatter: (params) => parseFloat(params.value).toFixed(1)
            }
        }],
        toolbox: {
            show: true,
            feature: {
                saveAsImage: { show: true, title: '保存为图片' }
            }
        }
    };
    echartsInstances[elementId].setOption(option);
}

/**
 * (已修改) 10.5. 渲染多科目箱形图
 * [!!] (重构) 手动计算箱形图数据，以便在异常值中显示学生姓名
 * @param {string} elementId
 * @param {Object} stats - G_Statistics
 * @param {Array} activeData - 传入学生数据
 */
function renderSubjectBoxPlot(elementId, stats, activeData) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) echartsInstances[elementId].dispose();
    echartsInstances[elementId] = echarts.init(chartDom);

    // 1. [!!] (新增) 辅助函数：手动计算分位数
    const getQuartiles = (scores) => {
        if (!scores || scores.length === 0) return { q1: 0, q2: 0, q3: 0 };
        // (注意) stats.scores 已经是排好序的
        const n = scores.length;
        const q1Index = Math.floor(n * 0.25);
        const q2Index = Math.floor(n * 0.5);
        const q3Index = Math.floor(n * 0.75);
        return {
            q1: scores[q1Index],
            q2: scores[q2Index], // 中位数
            q3: scores[q3Index]
        };
    };

    const boxData = [];    // 存储箱体数据
    const scatterData = []; // 存储异常值数据 (带姓名)
    const labels = G_DynamicSubjectList;

    // 2. [!!] (重构) 遍历所有科目
    labels.forEach((subject, subjectIndex) => {
        const s = stats[subject];
        // (如果该科目没有数据，跳过)
        if (!s || !s.scores || s.scores.length === 0) return;

        // 2.1 计算四分位数和 IQR (箱体)
        const { q1, q2, q3 } = getQuartiles(s.scores);
        const iqr = q3 - q1;

        // 2.2 计算上下限 (胡须)
        const lowerWhiskerLimit = q1 - 1.5 * iqr;
        const upperWhiskerLimit = q3 + 1.5 * iqr;

        // 2.3 找到胡须的实际位置 (在限制内的真实 min/max)
        let actualMin = Infinity;
        let actualMax = -Infinity;
        s.scores.forEach(score => {
            if (score >= lowerWhiskerLimit && score < actualMin) actualMin = score;
            if (score <= upperWhiskerLimit && score > actualMax) actualMax = score;
        });
        // (处理极端情况，如果所有值都是异常值)
        if (actualMin === Infinity) actualMin = q1;
        if (actualMax === -Infinity) actualMax = q3;

        // 2.4 添加箱体数据
        // ECharts 格式: [min, q1, q2, q3, max]
        boxData.push([actualMin, q1, q2, q3, actualMax]);

        // 2.5 (核心) 遍历 activeData 查找异常值学生
        activeData.forEach(student => {
            const score = student.scores[subject];
            if (score !== null && score !== undefined) {
                // (如果分数在胡须之外，则为异常值)
                if (score > upperWhiskerLimit || score < lowerWhiskerLimit) {
                    scatterData.push({
                        name: `${student.name} (${student.class})`, // [!!] (新增) 存储学生信息
                        value: [subjectIndex, score] // [X轴索引, Y轴分数]
                    });
                }
            }
        });
    });

    // 3. [!!] (删除) 移除 dataTool
    // const allScores = ...
    // const boxplotData = echarts.dataTool.prepareBoxplotData(allScores);

    // 4. (重构) ECharts 配置
    const option = {
        title: {
            left: 'center',
            textStyle: { fontSize: 16, fontWeight: 'normal' }
        },
        tooltip: {
            trigger: 'item',
            axisPointer: { type: 'shadow' }
        },
        grid: { left: '10%', right: '5%', bottom: '15%' },
        xAxis: {
            type: 'category',
            data: labels, // [!!] (修改)
            boundaryGap: true,
            nameGap: 30,
            axisLabel: { rotate: 30 }
        },
        yAxis: {
            type: 'value',
            name: '分数',
            splitArea: { show: true }
        },
        series: [
            {
                name: '箱形图',
                type: 'boxplot',
                data: boxData, // [!!] (修改)
                tooltip: {
                    formatter: function (param) {
                        // param.data[0] 是 xAxis 索引, param.data[1-5] 是 [min, q1, q2, q3, max]
                        return [
                            '<strong>' + labels[param.dataIndex] + '</strong>',
                            '最大值 (上须): ' + param.data[5],
                            '上四分位 (Q3): ' + param.data[4],
                            '中位数 (Q2): ' + param.data[3],
                            '下四分位 (Q1): ' + param.data[2],
                            '最小值 (下须): ' + param.data[1]
                        ].join('<br/>');
                    }
                }
            },
            {
                name: '异常值',
                type: 'scatter',
                data: scatterData, // [!!] (修改)
                // [!!] (新增) 为异常值定制 Tooltip
                tooltip: {
                    formatter: function (param) {
                        // param.data 是 { name: '...', value: [...] }
                        return `<strong>${param.data.name}</strong><br/>` +
                            `${labels[param.data.value[0]]}: <strong>${param.data.value[1]}</strong>分`;
                    }
                }
            }
        ],
        toolbox: {
            show: true,
            feature: {
                saveAsImage: { show: true, title: '保存为图片' }
            }
        }
    };
    echartsInstances[elementId].setOption(option);
}
/**
 * (已修改) 10.6. 渲染学科关联性散点图
 * [!!] (重构) 现在调用 calculateCorrelation() 辅助函数
 */
function renderCorrelationScatterPlot(elementId, activeData, xSubject, ySubject) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom || !activeData) return;

    if (echartsInstances[elementId]) echartsInstances[elementId].dispose();
    echartsInstances[elementId] = echarts.init(chartDom);

    // 1. 准备数据: [ [xScore, yScore], ... ]
    const scatterData = [];
    const xScores = []; // (用于计算相关系数)
    const yScores = []; // (用于计算相关系数)

    activeData.forEach(student => {
        const xScore = student.scores[xSubject];
        const yScore = student.scores[ySubject];

        if (xScore !== null && yScore !== null && xScore !== undefined && yScore !== undefined) {
            scatterData.push([xScore, yScore]);
            xScores.push(xScore);
            yScores.push(yScore);
        }
    });

    // 2. [!!] (重构) 调用新的辅助函数
    const correlationCoefficient = calculateCorrelation(xScores, yScores);
    const formattedCorrelation = correlationCoefficient.toFixed(2);

    // 3. 确定图表的 X/Y 轴最大值
    const maxX = G_SubjectConfigs[xSubject]?.full || 150;
    const maxY = G_SubjectConfigs[ySubject]?.full || 150;

    const option = {
        title: {
            text: `${xSubject} vs ${ySubject} 成绩关联性 (相关系数: ${formattedCorrelation})`,
            left: 'center',
            textStyle: { fontSize: 16, fontWeight: 'normal' }
        },
        grid: { left: '10%', right: '10%', bottom: '15%', top: '15%' },
        tooltip: {
            trigger: 'item',
            formatter: (params) => {
                if (params.seriesType === 'scatter') {
                    return `学生分数<br/>${xSubject}: ${params.data[0]}分<br/>${ySubject}: ${params.data[1]}分`;
                }
                return params.name;
            }
        },
        xAxis: {
            type: 'value',
            name: xSubject,
            min: 0,
            max: maxX,
            splitLine: { show: false }
        },
        yAxis: {
            type: 'value',
            name: ySubject,
            min: 0,
            max: maxY,
            splitLine: { show: false }
        },
        series: [{
            name: '学生',
            type: 'scatter',
            data: scatterData,
            symbolSize: 6,
            emphasis: {
                focus: 'series'
            },
            itemStyle: {
                opacity: 0.6
            },

            markLine: {
                silent: true,
                animation: false,
                lineStyle: {
                    color: '#9932CC',
                    type: 'dashed',
                    width: 2
                },
                symbol: 'none',
                data: [
                    [
                        {
                            name: '比例线',
                            coord: [0, 0],
                            label: { show: false }
                        },
                        {
                            coord: [maxX, maxY],
                            label: {
                                show: true,
                                formatter: '比例线',
                                position: 'end',
                                color: '#9932CC'
                            }
                        }
                    ]
                ]
            }
        }],
        toolbox: {
            show: true,
            feature: {
                saveAsImage: { show: true, title: '保存为图片' }
            }
        }
    };

    echartsInstances[elementId].setOption(option, true);
}


/**
 * (已修改) 10.7. 渲染 A/B/C/D 堆叠百分比条形图
 * [!!] (关键) A/B/C/D 的分界线现在从 config.good 读取
 */
function renderStackedBar(elementId, stats, configs) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) echartsInstances[elementId].dispose();
    echartsInstances[elementId] = echarts.init(chartDom);

    const categories = G_DynamicSubjectList;

    let aData = []; // A (优秀)
    let bData = []; // B (良好)
    let cData = []; // C (及格)
    let dData = []; // D (不及格)

    categories.forEach(subject => {
        const s = stats[subject];
        const config = configs[subject];

        if (!s || !config || !s.scores || s.scores.length === 0) {
            aData.push(0);
            bData.push(0);
            cData.push(0);
            dData.push(0);
            return;
        }

        const excelLine = config.excel;
        const passLine = config.pass;
        // [!!] 核心修正：从配置中读取可定义的 "良好线"
        const goodLine = config.good;
        const totalCount = s.scores.length;

        let countA = 0;
        let countB = 0;
        let countC = 0;
        let countD = 0;

        // 遍历该科目的所有分数，进行 4 级分箱
        s.scores.forEach(score => {
            if (score >= excelLine) {
                countA++;
            } else if (score >= goodLine) { // (已低于 excelLine)
                countB++;
            } else if (score >= passLine) { // (已低于 goodLine)
                countC++;
            } else { // (已低于 passLine)
                countD++;
            }
        });

        // 转换为百分比
        aData.push(parseFloat(((countA / totalCount) * 100).toFixed(1)));
        bData.push(parseFloat(((countB / totalCount) * 100).toFixed(1)));
        cData.push(parseFloat(((countC / totalCount) * 100).toFixed(1)));
        dData.push(parseFloat(((countD / totalCount) * 100).toFixed(1)));
    });

    const option = {
        title: {
            text: '各科 A/B/C/D 构成 (百分比)',
            left: 'center',
            textStyle: { fontSize: 16, fontWeight: 'normal' }
        },
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            formatter: (params) => {
                let tooltipHtml = `<strong>${params[0].name}</strong><br/>`;
                params.reverse().forEach(p => {
                    tooltipHtml += `${p.marker} ${p.seriesName}: ${p.value.toFixed(1)}%<br/>`;
                });
                return tooltipHtml;
            }
        },
        legend: { top: 30 },
        grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
        xAxis: {
            type: 'category',
            data: categories,
            axisLabel: { rotate: 30 }
        },
        yAxis: {
            type: 'value',
            name: '百分比 (%)',
            min: 0,
            max: 100
        },
        series: [
            {
                name: 'D (不及格)',
                type: 'bar',
                stack: 'total',
                emphasis: { focus: 'series' },
                data: dData,
                color: '#dc3545' // (var(--color-red))
            },
            {
                name: 'C (及格)',
                type: 'bar',
                stack: 'total',
                emphasis: { focus: 'series' },
                data: cData,
                color: '#ffc107' // (var(--color-yellow))
            },
            {
                name: 'B (良好)',
                type: 'bar',
                stack: 'total',
                emphasis: { focus: 'series' },
                data: bData,
                color: '#007bff' // (var(--color-blue))
            },
            {
                name: 'A (优秀)',
                type: 'bar',
                stack: 'total',
                barWidth: '60%',
                emphasis: { focus: 'series' },
                data: aData,
                color: '#28a745' // (var(--color-green))
            }
        ],
        toolbox: {
            show: true,
            feature: {
                saveAsImage: { show: true, title: '保存为图片' }
            }
        }
    };
    echartsInstances[elementId].setOption(option);
}

/**
 * (已修改) 10.8. 渲染学生个体 vs 年级平均雷达图
 * [!!] 新增了颜色区分
 */
function renderStudentRadar(elementId, student, stats) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    // 1. 准备雷达图指示器 (max 设为 100, 因为我们用得分率)
    const indicators = G_DynamicSubjectList.map(subject => {
        return { name: subject, max: 100 };
    });

    // 2. 计算 "学生得分率"
    const studentData = G_DynamicSubjectList.map(subject => {
        const score = student.scores[subject] || 0;
        const full = G_SubjectConfigs[subject]?.full;
        if (!full || full === 0) return 0; // 避免除以零
        return parseFloat(((score / full) * 100).toFixed(1));
    });

    // 3. 计算 "年级平均得分率"
    const averageData = G_DynamicSubjectList.map(subject => {
        const avgScore = stats[subject]?.average || 0;
        const full = G_SubjectConfigs[subject]?.full;
        if (!full || full === 0) return 0; // 避免除以零
        return parseFloat(((avgScore / full) * 100).toFixed(1));
    });

    const option = {
        title: {
            text: '学生 vs 年级平均 (得分率 %)',
            left: 'center',
            textStyle: { fontSize: 16, fontWeight: 'normal' }
        },
        tooltip: {
            trigger: 'item',
            formatter: (params) => {
                let s = `<strong>${params.name}</strong><br/>`;
                // [!!] 修正：tooltip 中也显示对应的颜色标记
                let studentColor = '#28a745'; // 学生的颜色
                let averageColor = '#007bff'; // 年级平均的颜色

                if (params.seriesName === '学生 vs 年级平均') {
                    // 当 hover 到线段时，params.value[0]是学生数据，params.value[1]是年级平均数据
                    s += `<span style="display:inline-block;margin-right:4px;border-radius:10px;width:10px;height:10px;background-color:${studentColor};"></span> 学生: ${studentData[params.dataIndex]}%<br/>`;
                    s += `<span style="display:inline-block;margin-right:4px;border-radius:10px;width:10px;height:10px;background-color:${averageColor};"></span> 年级平均: ${averageData[params.dataIndex]}%`;
                } else if (params.seriesName === '学生') { // 直接hover到“学生”的图例
                    s += `<span style="display:inline-block;margin-right:4px;border-radius:10px;width:10px;height:10px;background-color:${studentColor};"></span> ${params.name}: ${params.value}%`;
                } else if (params.seriesName === '年级平均') { // 直接hover到“年级平均”的图例
                    s += `<span style="display:inline-block;margin-right:4px;border-radius:10px;width:10px;height:10px;background-color:${averageColor};"></span> ${params.name}: ${params.value}%`;
                }
                return s;
            }
        },
        legend: {
            data: ['学生', '年级平均'],
            bottom: 10
        },
        radar: {
            indicator: indicators,
            radius: '65%', // 雷达图大小
            splitArea: {
                areaStyle: {
                    color: ['rgba(250,250,250,0.3)', 'rgba(200,200,200,0.3)']
                }
            }
        },
        series: [{
            name: '学生 vs 年级平均',
            type: 'radar',
            // [!!] 添加颜色配置
            itemStyle: {
                color: '#28a745' // 学生线的颜色 (绿色)
            },
            lineStyle: {
                color: '#28a745' // 学生线的颜色 (绿色)
            },
            data: [
                {
                    value: studentData,
                    name: '学生',
                    // [!!] 添加区域颜色
                    areaStyle: {
                        opacity: 0.4,
                        color: '#28a745' // 学生区域的颜色 (绿色)
                    },
                    itemStyle: { // 单独为学生数据点设置颜色
                        color: '#28a745'
                    },
                    lineStyle: { // 单独为学生数据线设置颜色
                        color: '#28a745'
                    }
                },
                {
                    value: averageData,
                    name: '年级平均',
                    // [!!] 添加区域颜色
                    areaStyle: {
                        opacity: 0.2,
                        color: '#007bff' // 年级平均区域的颜色 (蓝色)
                    },
                    itemStyle: { // 单独为年级平均数据点设置颜色
                        color: '#007bff'
                    },
                    lineStyle: { // 单独为年级平均数据线设置颜色
                        color: '#007bff'
                    }
                }
            ]
        }],
        toolbox: {
            show: true,
            feature: {
                saveAsImage: { show: true, title: '保存为图片' }
            }
        }
    };
    echartsInstances[elementId].setOption(option);
}


/**
 * (新增) 10.9. 渲染 难度-区分度 散点图
 * (用于试卷科目分析模块)
 * @param {string} elementId - DOM 元素 ID
 * @param {Object} stats - G_Statistics
 */
function renderDifficultyScatter(elementId, stats) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    // 1. 准备数据: [ [难度, 区分度, 满分(用于气泡大小), '科目名'], ... ]
    const scatterData = G_DynamicSubjectList.map(subject => {
        const s = stats[subject];
        if (!s) return null;

        // 气泡大小: 满分越高，气泡越大 (做一点缩放)
        const fullMark = G_SubjectConfigs[subject]?.full || 100;
        const bubbleSize = Math.sqrt(fullMark) * 1.5; // 基础大小

        return [
            s.difficulty,  // X 轴
            s.stdDev,      // Y 轴
            bubbleSize,    // Z 轴 (气泡大小)
            subject        // 标签
        ];
    }).filter(d => d !== null);

    const option = {
        title: {
            text: '难度 (X) vs 区分度 (Y)',
            left: 'center',
            textStyle: { fontSize: 16, fontWeight: 'normal' }
        },
        tooltip: {
            trigger: 'item',
            formatter: (params) => {
                const data = params.data;
                return `<strong>${data[3]}</strong><br/>` +
                    `难度 (越小越难): ${data[0]}<br/>` +
                    `区分度 (标准差): ${data[1]}`;
            }
        },
        grid: { left: '10%', right: '10%', bottom: '15%', top: '15%' },
        xAxis: {
            type: 'value',
            name: '难度系数 (越小越难)',
            min: 0,
            max: 1.0,
            splitLine: { show: true },
            nameLocation: 'middle',
            nameGap: 30
        },
        yAxis: {
            type: 'value',
            name: '区分度 (标准差)',
            splitLine: { show: true },
            nameLocation: 'middle',
            nameGap: 50 // (为Y轴留出更多空间)
        },
        series: [{
            name: '科目',
            type: 'scatter', // (气泡图本质上是散点图)
            data: scatterData,
            symbolSize: (data) => data[2] * 2, // 动态气泡大小
            label: { // (在点上显示科目名)
                show: true,
                formatter: (params) => params.data[3],
                position: 'bottom',
                fontSize: 12
            },
            itemStyle: {
                opacity: 0.7,
                color: '#007bff'
            }
        }],
        toolbox: {
            show: true,
            feature: {
                saveAsImage: { show: true, title: '保存为图片' }
            }
        }
    };
    echartsInstances[elementId].setOption(option);
}

/**
 * (新增) 10.10. 渲染进退步散点图 (Barbell Plot)
 * (用于成绩趋势对比模块)
 */
function renderTrendScatter(elementId, students) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    // 1. 过滤掉没有对比数据的学生，并按新排名排序
    const data = students
        .filter(s => s.oldRank !== null)
        .sort((a, b) => a.rank - b.rank); // 按新排名升序

    const studentNames = data.map(s => s.name);

    // 2. 准备 "上次排名" 和 "本次排名" 的数据
    const oldRankData = data.map((s, index) => [s.oldRank, index]);
    const newRankData = data.map((s, index) => [s.rank, index]);

    // 3. 准备 "连接线" (Barbell) 的数据
    const lineData = data.map((s, index) => {
        const color = s.rankDiff > 0 ? '#28a745' : s.rankDiff < 0 ? '#dc3545' : '#aaa'; // 绿 / 红 / 灰
        return {
            coords: [[s.oldRank, index], [s.rank, index]],
            lineStyle: { color: color, width: 1.5 }
        };
    });

    const option = {
        title: {
            text: '班级排名 进退步一览',
            subtext: '按本次班排 (Y轴) 排序',
            left: 'center',
            textStyle: { fontSize: 16, fontWeight: 'normal' }
        },
        tooltip: {
            trigger: 'item',
            formatter: (params) => {
                const dataIndex = params.data[1]; // Y 轴的索引
                const student = data[dataIndex];
                if (!student) return;

                let change = student.rankDiff > 0
                    ? `<strong style="color: #28a745;">进步 ${student.rankDiff} 名</strong>`
                    : student.rankDiff < 0
                        ? `<strong style="color: #dc3545;">退步 ${Math.abs(student.rankDiff)} 名</strong>`
                        : '排名不变';

                return `<strong>${student.name} (${student.id})</strong><br/>` +
                    `本次排名: ${student.rank}<br/>` +
                    `上次排名: ${student.oldRank}<br/>` +
                    `<strong>${change}</strong>`;
            }
        },
        grid: { left: '3%', right: '10%', bottom: '8%', containLabel: true },
        xAxis: {
            type: 'value',
            name: '班级排名',
            position: 'top',
            splitLine: { show: true },
            axisLine: { show: true },
            min: 0,
            inverse: true // [!!] 排名 1 在右侧
        },
        yAxis: {
            type: 'category',
            data: studentNames,
            axisLabel: { show: false }, // [!!] 姓名太多, 默认隐藏 (见 CSS)
            axisTick: { show: false }
        },
        series: [
            {
                name: '上次排名',
                type: 'scatter',
                data: oldRankData,
                symbolSize: 8,
                itemStyle: { color: '#aaa' }
            },
            {
                name: '本次排名',
                type: 'scatter',
                data: newRankData,
                symbolSize: 8,
                itemStyle: { color: '#007bff' }
            },
            {
                name: '进退',
                type: 'lines',
                data: lineData,
                symbol: 'none',
                silent: true // 线条不响应鼠标
            }
        ]
    };
    echartsInstances[elementId].setOption(option);
}

/**
 * (新增) 10.11. 渲染班排变化直方图
 * (用于成绩趋势对比模块)
 */
function renderTrendRankHistogram(elementId, allRankDiffs) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    // 1. 过滤无效数据
    const validDiffs = allRankDiffs.filter(d => typeof d === 'number');
    if (validDiffs.length === 0) {
        chartDom.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding-top: 50px;">无对比数据。</p>`;
        return;
    }

    // 2. 动态计算分箱 (binSize=5)
    const min = Math.min(...validDiffs);
    const max = Math.max(...validDiffs);
    const binSize = 5;

    const startBin = Math.floor(min / binSize) * binSize;
    const endBinLimit = Math.ceil((max + 1) / binSize) * binSize; // +1 确保最大值被包含

    const bins = {};
    const labels = [];
    for (let i = startBin; i < endBinLimit; i += binSize) {
        const label = `${i} ~ ${i + binSize - 1}`;
        bins[label] = 0;
        labels.push(label);
    }

    // 3. 填充数据
    validDiffs.forEach(diff => {
        const binIndex = Math.floor((diff - startBin) / binSize);
        if (labels[binIndex] && bins[labels[binIndex]] !== undefined) {
            bins[labels[binIndex]]++;
        }
    });

    const option = {
        title: {
            text: '班排变化分布',
            subtext: 'X轴: 排名变化 (正数为进步)',
            left: 'center',
            textStyle: { fontSize: 16, fontWeight: 'normal' }
        },
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            formatter: (params) => {
                const p = params[0];
                return `<strong>${p.name} 名</strong><br/>人数: ${p.value}`;
            }
        },
        grid: { left: '10%', right: '5%', bottom: '15%' },
        xAxis: {
            type: 'category',
            data: labels,
            axisLabel: { rotate: 30 }
        },
        yAxis: {
            type: 'value',
            name: '学生人数'
        },
        series: [{
            name: '人数',
            type: 'bar',
            data: Object.values(bins),
            // [!!] 颜色区分
            itemStyle: {
                color: (params) => {
                    // (简单判断) "0 ~ 4" 包含 0
                    if (params.name.startsWith('0 ~') || params.name.includes('-')) {
                        const start = parseInt(params.name.split(' ~ ')[0]);
                        if (start > 0) return '#28a745'; // 进步
                        if (start < -binSize + 1) return '#dc3545'; // 退步
                    }
                    return '#aaa'; // 中间
                }
            }
        }],
        toolbox: {
            show: true,
            feature: {
                saveAsImage: { show: true, title: '保存为图片' }
            }
        }
    };
    echartsInstances[elementId].setOption(option);
}

/**
 * (已修改) 10.11. 渲染学生进退步条形图
 * [!!] X轴 已修改为按 "学生姓名" 排序
 * [!!] 强制显示所有 X 轴标签 (interval: 0)
 */
// [!!] (修改) 增加 sortBy 参数, 默认为 'name'
function renderRankChangeBarChart(elementId, students, sortBy = 'name') {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    // 1. 过滤掉没有对比数据的学生
    const data = students.filter(s => s.oldRank !== null || s.oldGradeRank !== null);

    // [!!] (修改) 2. 根据 sortBy 参数动态排序
    const sortOption = sortBy.split('_');
    const sortKey = sortOption[0];
    const sortDir = sortOption[1] || 'asc'; // 'asc' for name, 'desc' for ranks by default

    data.sort((a, b) => {
        if (sortKey === 'name') {
            return a.name.localeCompare(b.name);
        }

        // (处理 null/undefined)
        let valA = a[sortKey];
        let valB = b[sortKey];

        // 将 null 视为最末尾
        valA = (valA === null || valA === undefined) ? (sortDir === 'asc' ? Infinity : -Infinity) : valA;
        valB = (valB === null || valB === undefined) ? (sortDir === 'asc' ? Infinity : -Infinity) : valB;

        return sortDir === 'asc' ? valA - valB : valB - valA;
    });

    // 3. 准备 ECharts 数据
    const studentNames = data.map(s => s.name);
    const classRankDiffs = data.map(s => s.rankDiff);
    const gradeRankDiffs = data.map(s => s.gradeRankDiff);

    const option = {
        title: {
            text: '学生 班排/年排 变化',
            subtext: '按学生姓名排序',
            left: 'center',
            textStyle: { fontSize: 16, fontWeight: 'normal' }
        },
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            formatter: (params) => {
                const studentName = params[0].name;
                let tip = `<strong>${studentName}</strong><br/>`;
                params.forEach(p => {
                    const value = p.value;
                    const change = value > 0 ? `进步 ${value} 名` : (value < 0 ? `退步 ${Math.abs(value)} 名` : '不变');
                    tip += `${p.marker} ${p.seriesName}: ${change}<br/>`;
                });
                return tip;
            }
        },
        legend: {
            data: ['班排变化', '年排变化'],
            top: 50
        },
        grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true, top: 100 }, // [!!] 调整 bottom
        xAxis: {
            type: 'category',
            data: studentNames,
            axisLabel: {
                rotate: 30, // 旋转标签
                interval: 0 // [!!] 核心修正：强制显示所有标签
            }
        },
        yAxis: {
            type: 'value',
            name: '排名变化 (正数为进步)'
        },
        dataZoom: [
            {
                type: 'inside',
                xAxisIndex: [0]
            },
            {
                type: 'slider',
                xAxisIndex: [0],
                bottom: 10, // [!!] 调整 dataZoom 位置
                height: 20
            }
        ],
        series: [
            {
                name: '班排变化',
                type: 'bar',
                barWidth: '50%',
                emphasis: { focus: 'series' },
                data: classRankDiffs,
                itemStyle: {
                    color: '#007bff' // 蓝色
                }
            },
            {
                name: '年排变化',
                type: 'bar',
                barWidth: '50%',
                emphasis: { focus: 'series' },
                data: gradeRankDiffs,
                itemStyle: {
                    color: '#ffc107' // 黄色
                }
            }
        ]
    };
    // [!!] 调整 grid 和 dataZoom 的位置
    option.grid.bottom = (data.length > 20 ? 50 : 30) + 'px'; // 如果人多，为 slider 留空间
    option.dataZoom[1].bottom = 10;

    echartsInstances[elementId].setOption(option);
}

/**
 * (新增) 10.16. [辅助函数] 计算偏科分析数据
 * (这是新模块的核心)
 */
// [!!] (修改) 接收 G_Statistics
function calculateWeaknessData(students, stats) {

    // (辅助函数)
    const mean = (arr) => {
        if (!arr || arr.length === 0) return 0;
        const validArr = arr.filter(v => typeof v === 'number' && !isNaN(v)); // [!!] (健壮性)
        if (validArr.length === 0) return 0;
        return validArr.reduce((sum, val) => sum + val, 0) / validArr.length;
    };
    const stdDev = (arr, meanVal) => {
        if (!arr || arr.length < 2) return 0;
        const validArr = arr.filter(v => typeof v === 'number' && !isNaN(v)); // [!!] (健壮性)
        if (validArr.length < 2) return 0;
        return Math.sqrt(validArr.reduce((sum, val) => sum + Math.pow(val - meanVal, 2), 0) / validArr.length);
    };

    const results = [];

    students.forEach(student => {
        // 1. [!!] (修改) 计算该生的所有 "Z-Score" (标准分)
        const zScores = [];
        const validSubjects = [];

        G_DynamicSubjectList.forEach(subject => {
            const subjectStat = stats[subject];
            const score = student.scores[subject];

            // (必须有分数, 且该科目有统计数据, 且标准差不为0)
            if (subjectStat && subjectStat.stdDev > 0 && score !== null && score !== undefined) {
                const z = (score - subjectStat.average) / subjectStat.stdDev;
                zScores.push(z);
                validSubjects.push(subject);
            }
        });

        if (zScores.length < 2) {
            results.push(null); // (数据不足，无法分析偏科)
            return;
        }

        // 2. [!!] (修改) 计算该生的 "平均Z-Score" 和 "Z-Score标准差" (即偏科程度)
        const avgZScore = mean(zScores);
        const stdDevZScore = stdDev(zScores, avgZScore);

        // 3. [!!] (修改) 计算每科的 "Z-Score偏离度"
        const subjectDeviations = [];
        zScores.forEach((z, index) => {
            const subject = validSubjects[index];
            subjectDeviations.push({
                subject: subject,
                zScore: parseFloat(z.toFixed(2)), // [!!] 该科Z分
                deviation: parseFloat((z - avgZScore).toFixed(2)) // [!!] 偏离度
            });
        });

        results.push({
            student: student,
            avgZScore: parseFloat(avgZScore.toFixed(2)), // [!!] (新) 学生综合能力 (Z分均值)
            stdDevZScore: parseFloat(stdDevZScore.toFixed(2)), // [!!] (新) 学生偏科程度 (Z分标准差)
            subjectDeviations: subjectDeviations
        });
    });

    return results.filter(r => r !== null); // 过滤掉无法分析的学生
}


/**
 * (最终修复版 V4 - 完美版) 解决 MarkLine、四色渲染、queryComponents 错误，并实现 X 轴动态缩放。
 */
// [!!] (修改) 接收 G_Statistics
function renderWeaknessScatter(elementId, weaknessData, stats) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    const myChart = echarts.init(chartDom);
    echartsInstances[elementId] = myChart;

    // 辅助函数: 计算平均值
    const mean = (arr) => {
        if (!arr || arr.length === 0) return 0;
        const validArr = arr.filter(val => typeof val === 'number' && !isNaN(val));
        if (validArr.length === 0) return 0;
        return validArr.reduce((sum, val) => sum + val, 0) / validArr.length;
    };

    // 1. [!!] (修改) 计算平均线
    // Z-Score 的均值理论上为 0
    const avgZScoreLine = 0;
    // 偏科程度的均值
    const yValues = weaknessData.map(d => d.stdDevZScore).filter(v => typeof v === 'number' && !isNaN(v));
    const avgStdDev = mean(yValues);

    // 2. 数据预处理
    const quadrantData = { '右上': [], '左上': [], '右下': [], '左下': [] };
    const xValuesRaw = [];
    const yValuesRaw = [];

    weaknessData.forEach(data => {
        // [!!] (修改) 使用 Z-Score
        const x = data.avgZScore;
        const y = data.stdDevZScore;
        const studentName = data.student.name;

        if (typeof x !== 'number' || isNaN(x) || typeof y !== 'number' || isNaN(y)) return;

        xValuesRaw.push(x);
        yValuesRaw.push(y);

        const quadrantKey = (x >= avgZScoreLine ? '右' : '左') + (y >= avgStdDev ? '上' : '下');
        quadrantData[quadrantKey].push([x, y, studentName]);
    });

    // 3. 🚀 [!!] (修改) 动态计算坐标轴范围 (Z-Score)
    // Z-Scores 是围绕 0 对称的
    const min_X = xValuesRaw.length > 0 ? Math.min(...xValuesRaw) : -2;
    const max_X = xValuesRaw.length > 0 ? Math.max(...xValuesRaw) : 2;
    const max_Y = yValuesRaw.length > 0 ? Math.max(...yValuesRaw) : 1.5;

    // X 轴动态范围, 至少 -2 到 2
    const dynamicMinX = Math.floor(Math.min(-0.5, min_X * 1.1) / 0.5) * 0.5;
    const dynamicMaxX = Math.ceil(Math.max(0.5, max_X * 1.1) / 0.5) * 0.5;
    // Y 轴动态范围
    const dynamicMaxY = Math.ceil(Math.max(0.5, max_Y * 1.1) / 0.5) * 0.5;

    // 4. 定义颜色和文本 (保持不变)
    const quadrantColors = {
        '右上': '#dc3545', '左上': '#ffc107', '右下': '#28a745', '左下': '#17a2b8'
    };
    const quadrantLabels = {
        '右上': '尖子生但有短板\n(重点关注)', '左上': '基础差且有\n极大短板',
        '右下': '学霸/全能型', '左下': '基础薄弱但\n各科均衡'
    };

    // 5. 初始 Option (不包含 graphic)
    const initialOption = {
        title: { text: '学生能力-均衡度 四象限图 (Z-Score)', left: 'center', textStyle: { fontSize: 16, fontWeight: 'normal' } },
        tooltip: {
            trigger: 'item',
            formatter: (params) => {
                if (params.componentType === 'graphic') return '';
                const data = params.data;
                // [!!] (修改) 更新 Tooltip
                return `<strong>${data[2]}</strong><br/>` +
                    `综合能力 (Z-Score均值): ${data[0].toFixed(2)}<br/>` +
                    `偏科程度 (Z-Score标准差): ${data[1].toFixed(2)}`;
            }
        },
        grid: { left: '10%', right: '10%', bottom: '10%', top: '10%' },
        xAxis: {
            type: 'value',
            // [!!] (修改) 更新 X 轴
            name: '综合能力 (平均Z-Score)',
            nameLocation: 'middle',
            nameGap: 30,
            min: dynamicMinX,
            max: dynamicMaxX
        },
        // [!!] (修改) 更新 Y 轴
        yAxis: { type: 'value', name: '偏科程度 (Z-Score标准差)', nameLocation: 'middle', nameGap: 40, min: 0, max: dynamicMaxY },

        series: [
            // 四个散点图系列 (保持不变)
            { name: '右上象限', type: 'scatter', data: quadrantData['右上'], symbolSize: 8, itemStyle: { opacity: 0.7, color: quadrantColors['右上'] } },
            { name: '左上象限', type: 'scatter', data: quadrantData['左上'], symbolSize: 8, itemStyle: { opacity: 0.7, color: quadrantColors['左上'] } },
            { name: '右下象限', type: 'scatter', data: quadrantData['右下'], symbolSize: 8, itemStyle: { opacity: 0.7, color: quadrantColors['右下'] } },
            { name: '左下象限', type: 'scatter', data: quadrantData['左下'], symbolSize: 8, itemStyle: { opacity: 0.7, color: quadrantColors['左下'] } },

            // [!!] (修改) 更新辅助 MarkLine
            {
                name: '辅助线', type: 'scatter', data: [],
                markLine: {
                    silent: true, animation: false, symbol: 'none',
                    lineStyle: { type: 'dashed', color: 'red' },
                    data: [
                        { xAxis: avgZScoreLine, name: '年级平均线', label: { formatter: '年级平均(0)' } },
                        { yAxis: avgStdDev, name: '平均偏科线', label: { formatter: '平均偏科' } }
                    ]
                }
            }
        ]
    };

    // 6. 第一次渲染：不包含 graphic 组件
    myChart.setOption(initialOption);

    // 7. 延迟 graphic 渲染
    setTimeout(() => {

        const graphicElements = [];
        // [!!] (修改) 使用 Z-Score 均值线
        const quadrantPositions = {
            '右上': [avgZScoreLine + (dynamicMaxX - avgZScoreLine) * 0.5, avgStdDev + (dynamicMaxY - avgStdDev) * 0.5],
            '左上': [dynamicMinX + (avgZScoreLine - dynamicMinX) * 0.5, avgStdDev + (dynamicMaxY - avgStdDev) * 0.5],
            '右下': [avgZScoreLine + (dynamicMaxX - avgZScoreLine) * 0.5, avgStdDev * 0.5],
            '左下': [dynamicMinX + (avgZScoreLine - dynamicMinX) * 0.5, avgStdDev * 0.5]
        };

        for (const key in quadrantPositions) {
            const [xCoord, yCoord] = quadrantPositions[key];

            // 确保坐标在 grid 范围内
            if (xCoord > dynamicMaxX || yCoord > dynamicMaxY || xCoord < dynamicMinX || yCoord < 0) continue;

            const [pixelX, pixelY] = myChart.convertToPixel('grid', [xCoord, yCoord]);

            graphicElements.push({
                type: 'text', left: pixelX, top: pixelY,
                style: {
                    text: quadrantLabels[key], fill: quadrantColors[key],
                    fontFamily: 'sans-serif', fontSize: 13, fontWeight: 'bold',
                    textAlign: 'center', textVerticalAlign: 'middle'
                },
                z: 100
            });
        }

        myChart.setOption({ graphic: graphicElements });

    }, 0);
}

/**
 * (新增) 10.18. 渲染“短板”学生表格
 */
function renderWeaknessTable(elementId, weaknessData) {
    const tableContainer = document.getElementById(elementId);
    if (!tableContainer) return;

    // 1. [!!] (重构) 创建 "学生最弱项" 列表
    // (不再使用 flatList, 而是每个学生一行)
    const studentWeaknessList = weaknessData.map(data => {
        if (!data.subjectDeviations || data.subjectDeviations.length === 0) {
            return { // (处理没有有效数据的学生)
                name: data.student.name,
                id: data.student.id,
                avgZScore: data.avgZScore,
                weakestSubject: 'N/A',
                weakestDeviation: 0,
                weakestZScore: 'N/A'
            };
        }

        // 找到偏离度最小的科目
        const weakest = data.subjectDeviations.reduce((minSub, currentSub) => {
            return currentSub.deviation < minSub.deviation ? currentSub : minSub;
        }, data.subjectDeviations[0]);

        return {
            name: data.student.name,
            id: data.student.id,
            avgZScore: data.avgZScore,
            weakestSubject: weakest.subject,
            weakestDeviation: weakest.deviation,
            weakestZScore: weakest.zScore
        };
    });

    // 2. 默认排序：按“最弱项偏离度”升序 (最弱的在最前面)
    studentWeaknessList.sort((a, b) => a.weakestDeviation - b.weakestDeviation);

    // 3. (新增) 渲染表格的内部函数 (用于搜索)
    const drawTable = () => {
        const searchTerm = document.getElementById('weakness-search').value.toLowerCase();

        const filteredList = studentWeaknessList.filter(item => {
            return String(item.name).toLowerCase().includes(searchTerm) ||
                String(item.id).toLowerCase().includes(searchTerm);
        });

        let html = ``;
        if (filteredList.length === 0) {
            html = `<p style="text-align: center; padding: 20px; color: var(--text-muted);">未找到匹配的学生。</p>`;
        } else {
            html = `
                <table>
                    <thead>
                        <tr>
                            <th>学生姓名</th>
                            <th>考号</th>
                            <th>最弱科目</th>
                            <th>最弱项偏离度</th>
                            <th>最弱项Z-Score</th>
                            <th>学生平均Z-Score</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${filteredList.map(item => `
                            <tr data-id="${item.id}" style="cursor: pointer;">
                                <td><strong>${item.name}</strong></td>
                                <td>${item.id}</td>
                                <td><strong>${item.weakestSubject}</strong></td>
                                <td><strong class="${item.weakestDeviation < -0.5 ? 'regress' : ''}">${item.weakestDeviation.toFixed(2)}</strong></td>
                                <td>${item.weakestZScore.toFixed ? item.weakestZScore.toFixed(2) : 'N/A'}</td>
                                <td>${item.avgZScore.toFixed(2)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        }
        tableContainer.innerHTML = html;
    };

    // 4. (新增) 绑定搜索框事件
    // (搜索框是在 renderWeakness 中创建的)
    const searchInput = document.getElementById('weakness-search');
    if (searchInput) {
        searchInput.addEventListener('input', drawTable);
    }

    // 5. 初始绘制
    drawTable();
}

/**
 * (新增) 10.19. 渲染单个学生的详细偏科表
 * (在 renderWeaknessTable 之后调用)
 */
function renderWeaknessDetail(containerElement, studentData) {
    const student = studentData.student;
    const deviations = [...studentData.subjectDeviations]; // 复制数组

    // 按偏离度升序排序 (最弱的在最前面)
    deviations.sort((a, b) => a.deviation - b.deviation);

    let html = `
        <h4>${student.name} (${student.id}) - 各科偏离度详情</h4>
        <div class="table-container" style="max-height: 400px; overflow-y: auto;">
            <table>
                <thead>
                    <tr>
                        <th>科目</th>
                        <th>该科Z-Score</th>
                        <th>学生平均Z-Score</th>
                        <th>偏离度 (该科Z - 均Z)</th>
                    </tr>
                </thead>
                <tbody>
                    ${deviations.map(item => `
                        <tr>
                            <td><strong>${item.subject}</strong></td>
                            <td>${item.zScore.toFixed(2)}</td>
                            <td>${studentData.avgZScore.toFixed(2)}</td>
                            <td>
                                <strong class="${item.deviation < -0.5 ? 'regress' : (item.deviation > 0.5 ? 'progress' : '')}">
                                    ${item.deviation.toFixed(2)}
                                </strong>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
    containerElement.innerHTML = html;
}


// ---------------------------------
// (新增) 10.21. 渲染不及格科目数条形图
// ---------------------------------
function renderFailureCountChart(elementId, failureCounts) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    const labels = Object.keys(failureCounts).sort((a, b) => a - b);
    const data = labels.map(key => failureCounts[key]);

    const option = {
        title: {
            text: '不及格科目数量分布',
            subtext: 'X轴: 不及格(含缺考)的科目数, Y轴: 学生人数',
            left: 'center',
            textStyle: { fontSize: 16, fontWeight: 'normal' }
        },
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            formatter: (params) => {
                const p = params[0];
                return `<strong>${p.name} 科</strong><br/>学生人数: <strong>${p.value}</strong>人`;
            }
        },
        grid: { left: '10%', right: '5%', bottom: '15%' },
        xAxis: {
            type: 'category',
            data: labels,
            name: '不及格科目数'
        },
        yAxis: {
            type: 'value',
            name: '学生人数'
        },
        series: [{
            name: '人数',
            type: 'bar',
            data: data,
            barWidth: '60%',
            label: {
                show: true,
                position: 'top'
            },
            itemStyle: {
                color: (params) => {
                    const failCount = parseInt(params.name);
                    if (failCount === 0) return '#28a745'; // 全及格 (绿)
                    if (failCount === 1) return '#007bff'; // 1科 (蓝)
                    if (failCount <= 3) return '#ffc107'; // 2-3科 (黄)
                    return '#dc3545'; // 4科及以上 (红)
                }
            }
        }]
    };
    echartsInstances[elementId].setOption(option);
}

// ---------------------------------
// (新增) 10.22. 渲染重叠直方图
// ---------------------------------
function renderOverlappingHistogram(elementId, currentScores, compareScores, subjectName) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    const cleanCurrent = currentScores.filter(s => typeof s === 'number' && !isNaN(s));
    const cleanCompare = compareScores.filter(s => typeof s === 'number' && !isNaN(s));

    if (cleanCurrent.length === 0 && cleanCompare.length === 0) {
        chartDom.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding-top: 50px;">无数据可供显示。</p>`;
        return;
    }

    // 1. (核心) 确定统一的分箱
    const allScores = [...cleanCurrent, ...cleanCompare];
    const min = Math.min(...allScores);
    const max = Math.max(...allScores);

    // 动态计算 binSize
    let fullScore = 150;
    if (subjectName === 'totalScore') {
        fullScore = G_DynamicSubjectList.reduce((sum, key) => sum + (G_SubjectConfigs[key]?.full || 0), 0);
    } else {
        fullScore = G_SubjectConfigs[subjectName]?.full || 150;
    }
    const binSize = Math.max(10, Math.round(fullScore / 15));

    const startBin = Math.floor(min / binSize) * binSize;
    const endBinLimit = Math.ceil((max + 0.01) / binSize) * binSize;

    const labels = [];
    const binsCurrent = {};
    const binsCompare = {};

    for (let i = startBin; i < endBinLimit; i += binSize) {
        const label = `${i}-${i + binSize}`;
        labels.push(label);
        binsCurrent[label] = 0;
        binsCompare[label] = 0;
    }

    // 2. 填充数据
    const fillBins = (scores, bins) => {
        scores.forEach(score => {
            const binIndex = Math.floor((score - startBin) / binSize);
            const label = labels[binIndex];
            if (label) {
                bins[label]++;
            }
        });
    };

    fillBins(cleanCurrent, binsCurrent);
    fillBins(cleanCompare, binsCompare);

    const dataCurrent = labels.map(label => binsCurrent[label]);
    const dataCompare = labels.map(label => binsCompare[label]);

    const option = {
        title: {
            text: `${subjectName} 成绩分布对比`,
            left: 'center',
            textStyle: { fontSize: 16, fontWeight: 'normal' }
        },
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' }
        },
        legend: {
            data: ['本次成绩', '对比成绩'],
            top: 30
        },
        grid: { left: '3%', right: '4%', bottom: '20%', containLabel: true },
        xAxis: {
            type: 'category',
            data: labels,
            name: '分数段',
            axisLabel: {
                interval: 'auto',
                rotate: labels.length > 10 ? 30 : 0
            }
        },
        yAxis: { type: 'value', name: '学生人数' },
        series: [
            {
                name: '对比成绩',
                type: 'bar',
                data: dataCompare,
                itemStyle: {
                    color: 'rgba(108, 117, 125, 0.5)' // 灰色
                }
            },
            {
                name: '本次成绩',
                type: 'bar',
                data: dataCurrent,
                itemStyle: {
                    color: 'rgba(0, 123, 255, 0.7)' // 蓝色
                }
            }
        ]
    };
    echartsInstances[elementId].setOption(option);
}


// ---------------------------------
// (新增) 10.23. 渲染排名流动桑基图
// ---------------------------------
function renderRankingSankey(elementId, mergedData, totalStudents) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    if (mergedData.length === 0) {
        chartDom.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding-top: 50px;">无匹配的学生数据。</p>`;
        return;
    }

    // 1. 定义分层
    // (我们动态地按百分比分层)
    const total = totalStudents;
    const rankTiers = [
        { name: 'Top 10%', min: 1, max: Math.ceil(total * 0.1) },
        { name: '10%-30%', min: Math.ceil(total * 0.1) + 1, max: Math.ceil(total * 0.3) },
        { name: '30%-60%', min: Math.ceil(total * 0.3) + 1, max: Math.ceil(total * 0.6) },
        { name: 'Bottom 40%', min: Math.ceil(total * 0.6) + 1, max: total }
    ];

    // (辅助函数)
    const getRankCategory = (rank) => {
        for (const tier of rankTiers) {
            if (rank >= tier.min && rank <= tier.max) {
                return tier.name;
            }
        }
        return 'N/A';
    };

    // 2. ECharts Nodes
    const nodes = [];
    rankTiers.forEach(tier => nodes.push({ name: `上次: ${tier.name}` }));
    rankTiers.forEach(tier => nodes.push({ name: `本次: ${tier.name}` }));

    // 3. ECharts Links
    const linksMap = {};

    mergedData.forEach(student => {
        const oldRank = student.oldRank;
        const newRank = student.rank;

        if (oldRank > 0 && newRank > 0) { // (必须两次排名都有效)
            const source = `上次: ${getRankCategory(oldRank)}`;
            const target = `本次: ${getRankCategory(newRank)}`;
            const key = `${source} -> ${target}`;

            linksMap[key] = (linksMap[key] || 0) + 1;
        }
    });

    const links = Object.keys(linksMap).map(key => {
        const [source, target] = key.split(' -> ');
        return {
            source: source,
            target: target,
            value: linksMap[key]
        };
    });

    const option = {
        title: {
            text: '总分排名分层流动图',
            subtext: '基于两次考试均参加的学生',
            left: 'center'
        },
        tooltip: {
            trigger: 'item',
            triggerOn: 'mousemove',
            formatter: (params) => {
                if (params.dataType === 'link') {
                    return `${params.data.source} → ${params.data.target}: ${params.data.value} 人`;
                }
                if (params.dataType === 'node') {
                    return `${params.name}: ${params.value} 人`;
                }
                return '';
            }
        },
        series: [{
            type: 'sankey',
            data: nodes,
            links: links,
            emphasis: {
                focus: 'adjacency'
            },
            nodeAlign: 'justify', // 两端对齐
            lineStyle: {
                color: 'source', // 颜色跟随源节点
                curveness: 0.5
            },
            label: {
                fontSize: 10
            }
        }]
    };
    echartsInstances[elementId].setOption(option);
}

/**
 * (新增) 10.24. 渲染临界生模块 - 单个学生科目详情
 * [!!] (已修改) - 不及格科目和分数均标红
 */
function renderBoundaryStudentDetail(containerElement, student) {

    // (从 G_DynamicSubjectList 构建科目数据)
    const subjectData = G_DynamicSubjectList.map(subject => {

        const score = student.scores[subject];
        const config = G_SubjectConfigs[subject];
        let scoreClass = '';

        if (config && typeof score === 'number' && score < config.pass) {
            scoreClass = 'regress'; //
        }

        return {
            name: subject,
            score: score || 'N/A',
            classRank: (student.classRanks && student.classRanks[subject]) ? student.classRanks[subject] : 'N/A',
            gradeRank: (student.gradeRanks && student.gradeRanks[subject]) ? student.gradeRanks[subject] : 'N/A',
            scoreClass: scoreClass
        };
    });

    let html = `
        <h4>${student.name} (${student.id}) - 全科成绩详情</h4>
        <div class="table-container" style="max-height: 400px; overflow-y: auto;">
            <table>
                <thead>
                    <tr>
                        <th>科目</th>
                        <th>得分</th>
                        <th>班级科目排名</th>
                        <th>年级科目排名</th>
                    </tr>
                </thead>
                <tbody>
                    ${subjectData.map(item => `
                        <tr>
                            <td class="${item.scoreClass}"><strong>${item.name}</strong></td>
                            <td class="${item.scoreClass}"><strong>${item.score}</strong></td>
                            <td>${item.classRank}</td>
                            <td>${item.gradeRank}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
    containerElement.innerHTML = html;
}

/**
 * (新增) 10.12. 渲染分层筛选 - 班级构成饼图
 */
function renderGroupClassPie(elementId, filteredStudents) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    // 1. 统计班级
    const classCounts = {};
    filteredStudents.forEach(student => {
        classCounts[student.class] = (classCounts[student.class] || 0) + 1;
    });

    // 2. 转换为 ECharts 数据
    const pieData = Object.keys(classCounts).map(className => {
        return {
            value: classCounts[className],
            name: className
        };
    }).sort((a, b) => b.value - a.value); // (按人数降序)

    const option = {
        title: {
            text: '筛选群体的班级构成',
            left: 'center',
            textStyle: { fontSize: 16, fontWeight: 'normal' }
        },
        tooltip: {
            trigger: 'item',
            formatter: '{b}: {c}人 ({d}%)'
        },
        legend: {
            orient: 'vertical',
            left: 'left',
            top: 'middle',
            data: pieData.map(d => d.name).slice(0, 10) // (最多显示10个图例)
        },
        series: [{
            name: '班级',
            type: 'pie',
            radius: ['40%', '70%'], // (空心圆)
            center: ['65%', '55%'], // (饼图靠右, 为图例腾空间)
            data: pieData,
            emphasis: {
                itemStyle: {
                    shadowBlur: 10,
                    shadowOffsetX: 0,
                    shadowColor: 'rgba(0, 0, 0, 0.5)'
                }
            },
            label: {
                show: false,
                position: 'center'
            }
        }]
    };
    echartsInstances[elementId].setOption(option);
}
/**
 * (新增) 10.13. 渲染分层筛选 - 群体能力雷达图
 * (对比 "筛选群体" vs "全体平均" 的得分率)
 * @param {Object} filteredStudents - 筛选出的学生
 * @param {Object} totalStats - G_Statistics (全体统计)
 */
function renderGroupRadarChart(elementId, filteredStudents, totalStats) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    // 1. (关键) 重新计算这个 "筛选群体" 的统计数据
    // [!!] 复用 calculateAllStatistics 函数
    const groupStats = calculateAllStatistics(filteredStudents);

    // 2. 准备雷达图指示器 (max 设为 1, 因为我们用难度/得分率)
    const indicators = G_DynamicSubjectList.map(subject => {
        // (动态获取最大值, 0.8 左右是比较好的最大值)
        const max = Math.max(
            totalStats[subject]?.difficulty || 0,
            groupStats[subject]?.difficulty || 0
        );
        return { name: subject, max: Math.max(1.0, Math.ceil(max * 10) / 10) };
    });

    // 3. (新增) 获取 "筛选群体" 的得分率 (即难度)
    const groupData = G_DynamicSubjectList.map(subject => {
        return groupStats[subject]?.difficulty || 0;
    });

    // 4. (新增) 获取 "全体平均" 的得分率 (即难度)
    const totalData = G_DynamicSubjectList.map(subject => {
        return totalStats[subject]?.difficulty || 0;
    });

    const option = {
        title: {
            text: '群体能力 vs 全体平均',
            subtext: '(指标: 得分率/难度)',
            left: 'center',
            textStyle: { fontSize: 16, fontWeight: 'normal' }
        },
        tooltip: { trigger: 'item' },
        legend: {
            data: ['筛选群体', '全体平均'],
            bottom: 10
        },
        radar: {
            indicator: indicators,
            radius: '65%',
            splitArea: {
                areaStyle: {
                    color: ['rgba(250,250,250,0.3)', 'rgba(200,200,200,0.3)']
                }
            }
        },
        series: [{
            name: '群体 vs 全体',
            type: 'radar',
            data: [
                {
                    value: groupData,
                    name: '筛选群体',
                    areaStyle: { opacity: 0.4, color: '#28a745' },
                    itemStyle: { color: '#28a745' },
                    lineStyle: { color: '#28a745' }
                },
                {
                    value: totalData,
                    name: '全体平均',
                    areaStyle: { opacity: 0.2, color: '#007bff' },
                    itemStyle: { color: '#007bff' },
                    lineStyle: { color: '#007bff' }
                }
            ]
        }],
        toolbox: {
            show: true,
            feature: {
                saveAsImage: { show: true, title: '保存为图片' }
            }
        }
    };
    echartsInstances[elementId].setOption(option);
}

/**
 * (新增) 10.14. [辅助函数] 计算皮尔逊相关系数
 * @param {Array<Number>} xScores - 数组 X
 * @param {Array<Number>} yScores - 数组 Y
 * @returns {Number} - 相关系数 ( -1 到 1 )
 */
function calculateCorrelation(xScores, yScores) {
    if (!xScores || !yScores || xScores.length !== yScores.length || xScores.length < 2) {
        return 0; // 无法计算
    }

    const n = xScores.length;
    const mean = (arr) => arr.reduce((sum, val) => sum + val, 0) / n;

    const meanX = mean(xScores);
    const meanY = mean(yScores);

    const stdDev = (arr, meanVal) => Math.sqrt(arr.reduce((sum, val) => sum + Math.pow(val - meanVal, 2), 0) / n);

    const stdDevX = stdDev(xScores, meanX);
    const stdDevY = stdDev(yScores, meanY);

    if (stdDevX === 0 || stdDevY === 0) {
        return 0; // (没有方差，无法计算)
    }

    let covariance = 0;
    for (let i = 0; i < n; i++) {
        covariance += (xScores[i] - meanX) * (yScores[i] - meanY);
    }

    const correlationCoefficient = covariance / (n * stdDevX * stdDevY);
    return correlationCoefficient;
}

/**
 * (新增) 10.20. 渲染单科A/B/C/D等级构成饼图
 */
function renderSingleSubjectPie(elementId, subjectStats) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    // [!!] 从 stats 中获取 A, B, C, D 的比率
    // A = 优秀率
    // B = 良好率
    // C = C率 (及格但未良好)
    // D = 不及格率
    const pieData = [
        { value: subjectStats.excellentRate || 0, name: 'A (优秀)' },
        { value: subjectStats.goodRate || 0, name: 'B (良好)' },
        { value: subjectStats.cRate || 0, name: 'C (及格)' },
        { value: subjectStats.failRate || 0, name: 'D (不及格)' }
    ];

    const option = {
        title: {
            text: '等级构成',
            left: 'center',
            textStyle: { fontSize: 16, fontWeight: 'normal' }
        },
        tooltip: {
            trigger: 'item',
            formatter: '{b}: {c}%'
        },
        legend: {
            orient: 'vertical',
            left: 'left',
            top: 'middle'
        },
        series: [{
            name: '等级',
            type: 'pie',
            radius: ['40%', '70%'], // (空心圆)
            center: ['65%', '55%'], // (饼图靠右, 为图例腾空间)
            data: pieData,
            emphasis: {
                itemStyle: {
                    shadowBlur: 10,
                    shadowOffsetX: 0,
                    shadowColor: 'rgba(0, 0, 0, 0.5)'
                }
            },
            label: {
                show: true,
                formatter: '{d}%', // (在饼图上显示百分比)
                position: 'inside',
                color: '#fff'
            },
            // [!!] (新增) 颜色映射
            color: [
                '#28a745', // A (绿)
                '#007bff', // B (蓝)
                '#ffc107', // C (黄)
                '#dc3545'  // D (红)
            ]
        }]
    };
    echartsInstances[elementId].setOption(option);
}

// ---------------------------------
// (新增) 10.21. 渲染不及格科目数条形图
// ---------------------------------
// [!!] (修改) 接收 failureData (对象) 而不是 failureCounts (数字)
function renderFailureCountChart(elementId, failureData) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    // [!!] (修改) 从 failureData 计算 labels 和 data
    const labels = Object.keys(failureData).sort((a, b) => a - b); // ['0', '1', '2']
    const data = labels.map(key => {
        const students = failureData[key] || [];
        return {
            value: students.length, // [!!] (修改) value 是数组长度
            names: students.map(s => s.name) // [!!] (新增) 存储姓名用于 tooltip
        };
    });
    const categoryLabels = labels.map(l => `${l} 科`); // ['0 科', '1 科', '2 科']


    const option = {
        title: {
            text: '不及格科目数量分布',
            subtext: 'X轴: 不及格(含缺考)的科目数, Y轴: 学生人数',
            left: 'center',
            textStyle: { fontSize: 16, fontWeight: 'normal' }
        },
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            formatter: (params) => {
                // [!!] (修改) Tooltip 显示姓名
                const p = params[0];
                const names = p.data.names || [];
                let namesHtml = names.slice(0, 10).join('<br/>');
                if (names.length > 10) {
                    namesHtml += `<br/>... (及另外 ${names.length - 10} 人)`;
                }

                return `<strong>${p.name}</strong><br/>` +
                    `学生人数: <strong>${p.value}</strong>人` +
                    `<hr style="margin: 5px 0; border-color: #eee;"/>` +
                    `${namesHtml}`;
            }
        },
        grid: { left: '10%', right: '5%', bottom: '15%' },
        xAxis: {
            type: 'category',
            data: categoryLabels, // [!!] (修改)
            name: '不及格科目数'
        },
        yAxis: {
            type: 'value',
            name: '学生人数'
        },
        series: [{
            name: '人数',
            type: 'bar',
            data: data, // [!!] (修改)
            barWidth: '60%',
            label: {
                show: true,
                position: 'top'
            },
            itemStyle: {
                color: (params) => {
                    // [!!] (修改) 解析 '0 科'
                    const failCount = parseInt(params.name.split(' ')[0]);
                    if (failCount === 0) return '#28a745'; // 全及格 (绿)
                    if (failCount === 1) return '#007bff'; // 1科 (蓝)
                    if (failCount <= 3) return '#ffc107'; // 2-3科 (黄)
                    return '#dc3545'; // 4科及以上 (红)
                }
            }
        }]
    };
    echartsInstances[elementId].setOption(option);
    return echartsInstances[elementId]; // [!!] (新增) 返回实例
}

// ---------------------------------
// (新增) 10.23. 渲染排名流动桑基图
// ---------------------------------
// [!!] (修改) 传入分层逻辑, 并返回实例
function renderRankingSankey(elementId, mergedData, rankTiers, getRankCategory, currentFilter) { // [!!] (修改) 接收 currentFilter
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return null; // [!!] (修改)

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    if (mergedData.length === 0) {
        chartDom.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding-top: 50px;">无匹配的学生数据。</p>`;
        return null; // [!!] (修改)
    }

    // 1. [!!] (删除) 分层逻辑已移出
    // const total = ...
    // const rankTiers = ...
    // const getRankCategory = ...

    // 2. ECharts Nodes (不变)
    const nodes = [];
    rankTiers.forEach(tier => nodes.push({ name: `上次: ${tier.name}` }));
    rankTiers.forEach(tier => nodes.push({ name: `本次: ${tier.name}` }));

    // 3. ECharts Links (不变)
    const linksMap = {};

    mergedData.forEach(student => {
        // [!!] (核心修复) 根据筛选器选择使用 年排 还是 班排
        const useGradeRank = (currentFilter === 'ALL');

        const oldRank = useGradeRank ? (student.oldGradeRank || 0) : student.oldRank;
        const newRank = useGradeRank ? (student.gradeRank || 0) : student.rank;

        if (oldRank > 0 && newRank > 0) { // (必须两次排名都有效)
            const source = `上次: ${getRankCategory(oldRank)}`;
            const target = `本次: ${getRankCategory(newRank)}`;
            const key = `${source} -> ${target}`;

            linksMap[key] = (linksMap[key] || 0) + 1;
        }
    });

    const links = Object.keys(linksMap).map(key => {
        const [source, target] = key.split(' -> ');
        return {
            source: source,
            target: target,
            value: linksMap[key]
        };
    });

    const option = {
        title: {
            text: '总分排名分层流动图',
            subtext: '基于两次考试均参加的学生',
            left: 'center'
        },
        tooltip: {
            trigger: 'item',
            triggerOn: 'mousemove',
            formatter: (params) => {
                if (params.dataType === 'link') {
                    return `${params.data.source} → ${params.data.target}: ${params.data.value} 人`;
                }
                if (params.dataType === 'node') {
                    return `${params.name}: ${params.value} 人`;
                }
                return '';
            }
        },
        series: [{
            type: 'sankey',
            data: nodes,
            links: links,
            emphasis: {
                focus: 'adjacency'
            },
            nodeAlign: 'justify', // 两端对齐
            lineStyle: {
                color: 'source', // 颜色跟随源节点
                curveness: 0.5
            },
            label: {
                fontSize: 10,
                position: 'inside', // [!!] (新增) 强制标签在节点内部显示
                color: '#333'      // [!!] (新增) 确保标签在彩色背景上(如粉色/绿色)可读
            }
        }]
    };
    echartsInstances[elementId].setOption(option);
    return echartsInstances[elementId]; // [!!] (新增) 返回实例
}


/**
 * (新增) 11.1. 计算所有班级的统计数据 (用于班级对比)
 * @param {string} metric - 'average', 'passRate', 'stdDev'
 * @param {string} subject - 'totalScore', '语文', ...
 * @returns {Array} - e.g., [{ name: '高一1班', value: 85.5 }, ...]
 */
function calculateClassComparison(metric, subject) {
    if (!G_StudentsData || G_StudentsData.length === 0) return [];

    const classes = [...new Set(G_StudentsData.map(s => s.class))].sort();
    const classData = [];

    for (const className of classes) {
        // 1. 筛选出该班的学生
        const classStudents = G_StudentsData.filter(s => s.class === className);

        // 2. 为该班计算统计数据 (使用全局科目配置)
        const classStats = calculateAllStatistics(classStudents);

        // 3. 提取所需的特定指标
        let value = 0;
        if (classStats[subject] && classStats[subject][metric] !== undefined) {
            value = classStats[subject][metric];
        }

        classData.push({
            name: className.replace('高一年级', ''), // 简化班级名称 (可自定义)
            value: value
        });
    }



    return classData;
}

/**
 * (新增) 10.25. (ECharts) 渲染多次考试曲线图 (通用)
 */
function renderMultiExamLineChart(elementId, title, examNames, seriesData, yAxisInverse) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    const option = {
        title: {
            text: title,
            left: 'center',
            textStyle: { fontSize: 16, fontWeight: 'normal' }
        },
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'cross' }
        },
        legend: {
            top: 30,
            type: 'scroll' // (如果科目太多)
        },
        grid: {
            left: '10%',
            right: '10%',
            bottom: '15%',
            top: 70
        },
        xAxis: {
            type: 'category',
            boundaryGap: false,
            data: examNames,
            axisLabel: {
                rotate: 15,
                interval: 0 // (强制显示所有X轴标签)
            }
        },
        yAxis: {
            type: 'value',
            inverse: yAxisInverse, // [!!] (排名图需要反转)
            axisPointer: {
                snap: true
            }
        },
        dataZoom: [ // (允许缩放)
            {
                type: 'inside',
                xAxisIndex: [0]
            },
            {
                type: 'slider',
                xAxisIndex: [0],
                bottom: 10,
                height: 20
            }
        ],
        series: seriesData
    };

    echartsInstances[elementId].setOption(option);
}

/**
 * (新增) 11. 启动时从 localStorage 加载数据
 * [!!] (完整修复版)
 */
function loadDataFromStorage() {
    // 1. 尝试读取已存储的数据
    const storedData = localStorage.getItem('G_StudentsData');
    const storedCompareData = localStorage.getItem('G_CompareData');
    const storedConfigs = localStorage.getItem('G_SubjectConfigs');

    const storedMainFile = localStorage.getItem('G_MainFileName');
    const storedCompareFile = localStorage.getItem('G_CompareFileName');

    // 2. 如果没有“本次成绩”，则什么也不做
    if (!storedData) {
        console.log("未找到本地存储的数据。");
        return;
    }

    console.log("发现本地存储数据，正在加载...");

    // 3. 恢复数据到全局变量
    G_StudentsData = JSON.parse(storedData);

    if (storedCompareData) {
        G_CompareData = JSON.parse(storedCompareData);
    }

    if (storedConfigs) {
        G_SubjectConfigs = JSON.parse(storedConfigs);
    }

    // 4. (关键) 运行所有启动程序
    populateClassFilter(G_StudentsData);

    // (解锁) 解锁 UI
    welcomeScreen.style.display = 'none';

    // [!!] (修复) 查找修复后的 'import-compare-btn'
    const compareBtnEl = document.getElementById('import-compare-btn');
    if (compareBtnEl) {
        compareBtnEl.classList.remove('disabled');
    }

    navLinks.forEach(l => l.classList.remove('disabled'));
    classFilterContainer.style.display = 'block';
    classFilterHr.style.display = 'block';

    // 5. 恢复上传标签的提示文字
    if (storedMainFile) {
        const mainBtn = document.getElementById('import-main-btn');
        if (mainBtn) {
            mainBtn.innerHTML = `✅ ${storedMainFile} (已加载)`;
        }
    }
    if (storedCompareFile) {
        // [!!] (修复) 'compareBtnEl' 变量已在上面定义
        // (这就是 L237 错误发生的地方)
        if (compareBtnEl) {
            compareBtnEl.innerHTML = `✅ ${storedCompareFile} (已加载)`;
        }
    }

    // 6. (运行) 运行分析
    runAnalysisAndRender();
}

/**
 * (新增) 11.2. (重构) 渲染“多次考试”的UI列表
 */
function renderMultiExamList(multiExamData) {
    const listContainer = document.getElementById('multi-exam-list');
    if (!listContainer) return;

    if (!multiExamData || multiExamData.length === 0) {
        listContainer.innerHTML = `<li class="multi-exam-item-empty">暂无数据，请点击“添加新成绩”上传。</li>`;
        return;
    }

    listContainer.innerHTML = multiExamData.map((item, index) => {
        return `
            <li class="multi-exam-item" data-id="${item.id}">
                <span class="multi-exam-index">${index + 1}.</span>
                <input type="text" value="${item.label}" data-role="label" class="multi-exam-label" title="点击可重命名: ${item.originalName}">
                <div class="multi-exam-buttons">
                    <button data-role="up" ${index === 0 ? 'disabled' : ''}>▲</button>
                    <button data-role="down" ${index === multiExamData.length - 1 ? 'disabled' : ''}>▼</button>
                    <button data-role="delete" class="delete-btn">×</button>
                </div>
            </li>
        `;
    }).join('');
}

/**
 * (新增) 11.3. (重构) 保存“多次考试”数据到 LocalStorage
 */
function saveMultiExamData(data) {
    localStorage.setItem('G_MultiExamData', JSON.stringify(data));
}

/**
 * (新增) 11.4. (重构) 从 LocalStorage 加载“多次考试”数据
 */
function loadMultiExamData() {
    const storedData = localStorage.getItem('G_MultiExamData');
    return storedData ? JSON.parse(storedData) : [];
}


/**
 * (重构) 11.5. 初始化“多次考试分析”的学生搜索框
 * [!!] (已修改) 添加了筛选器的事件监听
 */
function initializeStudentSearch(multiExamData) {
    const searchInput = document.getElementById('multi-student-search');
    const resultsContainer = document.getElementById('multi-student-search-results');
    const reportContainer = document.getElementById('multi-student-report');

    if (!searchInput) return; // (如果不在当前模块, DOM不存在)

    // (计算所有学生列表 - 不变)
    const allStudentsMap = new Map();
    multiExamData.forEach(exam => {
        exam.students.forEach(student => {
            if (!allStudentsMap.has(student.id)) {
                allStudentsMap.set(student.id, student.name);
            }
        });
    });
    const allStudentsList = Array.from(allStudentsMap, ([id, name]) => ({ id, name }));

    // (搜索框 input 事件 - 不变)
    searchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        if (searchTerm.length < 1) {
            resultsContainer.innerHTML = '';
            resultsContainer.style.display = 'none';
            return;
        }
        const filteredStudents = allStudentsList.filter(s => {
            return String(s.name).toLowerCase().includes(searchTerm) ||
                String(s.id).toLowerCase().includes(searchTerm);
        }).slice(0, 50);

        if (filteredStudents.length === 0) {
            resultsContainer.innerHTML = '<div class="result-item">-- 未找到 --</div>';
        } else {
            resultsContainer.innerHTML = filteredStudents.map(s => {
                return `<div class="result-item" data-id="${s.id}">
                    <strong>${s.name}</strong> (${s.id})
                </div>`;
            }).join('');
        }
        resultsContainer.style.display = 'block';
    });

    // (点击搜索结果 事件 - [!!] 修改)
    resultsContainer.addEventListener('click', (e) => {
        const item = e.target.closest('.result-item');
        if (item && item.dataset.id) {
            const studentId = item.dataset.id;
            const studentName = item.querySelector('strong').innerText;

            searchInput.value = `${studentName} (${studentId})`;
            resultsContainer.innerHTML = '';
            resultsContainer.style.display = 'none';

            document.getElementById('multi-student-name-title').innerText = `${studentName} 的成绩曲线`;
            reportContainer.style.display = 'block';

            // [!!] (新增) 存储当前学生ID，以便筛选器使用
            reportContainer.dataset.studentId = studentId;

            // (调用新函数)
            drawMultiExamChartsAndTable(studentId, loadMultiExamData(), true); // [!!] true = 强制重绘复选框
        }
    });

    // (点击外部 隐藏 - 不变)
    document.addEventListener('click', (e) => {
        if (searchInput && !searchInput.contains(e.target) && resultsContainer && !resultsContainer.contains(e.target)) {
            resultsContainer.style.display = 'none';
        }
    });

    // [!!] (新增) 绑定筛选器事件
    const checkboxContainer = document.getElementById('multi-subject-checkboxes');
    const selectAllBtn = document.getElementById('multi-subject-all');
    const selectNoneBtn = document.getElementById('multi-subject-none');

    // (辅助函数：重绘图表)
    const redrawCharts = () => {
        const currentStudentId = reportContainer.dataset.studentId;
        if (currentStudentId) {
            drawMultiExamChartsAndTable(currentStudentId, loadMultiExamData(), false); // [!!] false = 不重绘复选框
        }
    };

    // (复选框点击事件 - 委托)
    if (checkboxContainer) {
        checkboxContainer.addEventListener('change', redrawCharts);
    }

    // (全选)
    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', () => {
            checkboxContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
            redrawCharts();
        });
    }

    // (全不选)
    if (selectNoneBtn) {
        selectNoneBtn.addEventListener('click', () => {
            checkboxContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
            redrawCharts();
        });
    }
}


/**
 * (重构) 11.6. (核心) 绘制多次考试的图表和表格
 * [!!] (已修改) 添加了复选框填充和数据筛选逻辑
 */
function drawMultiExamChartsAndTable(studentId, multiExamData, forceRepopulateCheckboxes = false) {
    // [!!] (重构) X轴标签来自用户定义的 label
    const examNames = multiExamData.map(e => e.label);

    const rankSeries = [];
    const scoreSeries = [];

    const rankData = {
        classRank: [],
        gradeRank: []
    };
    const subjectData = {};

    // 1. (重构) 动态初始化科目列表 (基于所有考试的并集)
    const allSubjects = new Set();
    multiExamData.forEach(exam => {
        exam.students.forEach(s => {
            Object.keys(s.scores).forEach(subject => allSubjects.add(subject));
        });
    });

    const dynamicSubjects = Array.from(allSubjects);
    dynamicSubjects.forEach(subject => {
        subjectData[subject] = [];
    });

    // 2. 遍历所有考试，填充数据 (不变)
    multiExamData.forEach(exam => {
        const student = exam.students.find(s => String(s.id) === String(studentId));

        if (student) {
            dynamicSubjects.forEach(subject => {
                subjectData[subject].push(student.scores[subject] || null);
            });
            rankData.classRank.push(student.rank || null);
            rankData.gradeRank.push(student.gradeRank || null);
        } else {
            dynamicSubjects.forEach(subject => {
                subjectData[subject].push(null);
            });
            rankData.classRank.push(null);
            rankData.gradeRank.push(null);
        }
    });

    // 3. 转换为 ECharts Series 格式 (用于图表)
    dynamicSubjects.forEach(subject => {
        scoreSeries.push({
            name: subject,
            type: 'line',
            data: subjectData[subject],
            smooth: true,
            connectNulls: true
        });
    });

    rankSeries.push({
        name: '班级排名',
        type: 'line',
        data: rankData.classRank,
        smooth: true,
        connectNulls: true
    });
    rankSeries.push({
        name: '年级排名',
        type: 'line',
        data: rankData.gradeRank,
        smooth: true,
        connectNulls: true
    });

    // 4. [!!] (新增) 填充复选框
    const checkboxContainer = document.getElementById('multi-subject-checkboxes');
    if (checkboxContainer && forceRepopulateCheckboxes) {
        checkboxContainer.innerHTML = dynamicSubjects.map(subject => `
            <div>
                <input type="checkbox" id="multi-cb-${subject}" value="${subject}" checked>
                <label for="multi-cb-${subject}">${subject}</label>
            </div>
        `).join('');
    }

    // 5. [!!] (新增) 根据复选框筛选数据
    const checkedSubjects = new Set();
    if (checkboxContainer) {
        checkboxContainer.querySelectorAll('input:checked').forEach(cb => checkedSubjects.add(cb.value));
    }
    // (如果一个都没勾选，也按空数组筛选)
    const filteredScoreSeries = scoreSeries.filter(series => checkedSubjects.has(series.name));

    // 6. 绘图 ( [!!] 修改)
    renderMultiExamLineChart('multi-exam-score-chart', '各科成绩曲线', examNames, filteredScoreSeries, false); // [!!] 使用过滤后的数据
    renderMultiExamLineChart('multi-exam-rank-chart', '排名变化曲线', examNames, rankSeries, true); // (排名图不变)

    // 7. [!!] (新增) 绘制详细数据表格 (不变)
    const tableContainer = document.getElementById('multi-student-table-container');
    if (!tableContainer) return;

    let tableHtml = `
        <h4>成绩详情表</h4>
        <div class="table-container" style="max-height: 400px;">
            <table>
                <thead>
                    <tr>
                        <th>考试名称</th>
                        <th>班级排名</th>
                        <th>年级排名</th>
                        ${dynamicSubjects.map(s => `<th>${s}</th>`).join('')}
                    </tr>
                </thead>
                <tbody>
                    ${examNames.map((examName, index) => `
                        <tr>
                            <td><strong>${examName}</strong></td>
                            <td>${rankData.classRank[index] || 'N/A'}</td>
                            <td>${rankData.gradeRank[index] || 'N/A'}</td>
                            ${dynamicSubjects.map(subject => `
                                <td>${subjectData[subject][index] || 'N/A'}</td>
                            `).join('')}
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
    tableContainer.innerHTML = tableHtml;
}

/**
 * (新增) 11.7. 打开“导入来源”模态框
 */
function openImportModal() {
    const importModal = document.getElementById('import-modal');
    const importModalSelect = document.getElementById('import-modal-select');
    const importModalFromStorageBtn = document.getElementById('import-modal-from-storage');

    // 1. (复用) 加载“模块十二”的数据
    const multiData = loadMultiExamData();

    // 2. 填充下拉框
    if (multiData.length > 0) {
        importModalSelect.innerHTML = multiData.map(exam => {
            return `<option value="${exam.id}">${exam.label} (原始: ${exam.originalName})</option>`;
        }).join('');
        importModalSelect.disabled = false;
        importModalFromStorageBtn.disabled = false;
    } else {
        importModalSelect.innerHTML = '<option value="">“模块十二”中暂无数据</option>';
        importModalSelect.disabled = true;
        importModalFromStorageBtn.disabled = true;
    }

    // 3. 显示模态框
    importModal.style.display = 'flex';
}