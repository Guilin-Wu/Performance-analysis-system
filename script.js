/* eslint-disable no-undef */ // 告诉编辑器 ECharts 和 XLSX 是全局变量

'use strict';

// ---------------------------------
// 1. 全局配置与状态
// ---------------------------------
// (已从您的CSV文件确认，不含'技术')
const SUBJECT_LIST = ['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理'];

// 存储数据
let G_StudentsData = []; // { id, name, class, totalScore, rank, gradeRank, scores: {...} }
let G_CompareData = [];  // 同上, 用于对比
let G_Statistics = {};   // 存储当前 *已筛选* 后的统计数据
let G_CompareStatistics = {};
let G_TrendSort = { key: 'rank', direction: 'asc' }; // [!!] (新增) 趋势模块的排序状态

// 存储UI状态
let G_CurrentClassFilter = 'ALL';
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
    compareUploadLabel = document.getElementById('compare-upload-label');
    navLinks = document.querySelectorAll('.nav-link');
    modulePanels = document.querySelectorAll('.module-panel');
    welcomeScreen = document.getElementById('welcome-screen');

    // (新增) 班级筛选
    classFilterContainer = document.getElementById('class-filter-container');
    classFilterSelect = document.getElementById('class-filter');
    classFilterHr = document.getElementById('class-filter-hr');

    // (新增) 科目配置
    modal = document.getElementById('subject-config-modal');
    modalCloseBtn = document.getElementById('modal-close-btn');
    modalSaveBtn = document.getElementById('modal-save-btn');
    configSubjectsBtn = document.getElementById('config-subjects-btn');
    subjectConfigTableBody = document.getElementById('subject-config-table').getElementsByTagName('tbody')[0];

    // 初始化 UI
    initializeUI();
    initializeSubjectConfigs(); // 初始化科目配置
    loadDataFromStorage();

    // ---------------------------------
    // 3. 事件监听器
    // ---------------------------------

    // 监听文件上传 (本次成绩)
    fileUploader.addEventListener('change', async (event) => {
        await handleFileData(event, 'main');
    });

    // 监听文件上传 (对比成绩)
    fileUploaderCompare.addEventListener('change', async (event) => {
        await handleFileData(event, 'compare');
    });

    // 监听导航切换
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            if (link.classList.contains('disabled')) {
                alert('请先导入本次成绩数据！');
                return;
            }
            const targetModule = link.getAttribute('data-module');

            // 趋势模块特殊检查
            if (targetModule === 'trend' && G_CompareData.length === 0) {
                alert('请先导入 "对比成绩" 数据，才能使用趋势分析！');
                return;
            }

            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');

            // (重构) 导航切换只负责渲染，不负责重新计算
            runAnalysisAndRender();
        });
    });

    // (新增) 班级筛选
    classFilterSelect.addEventListener('change', () => {
        G_CurrentClassFilter = classFilterSelect.value;
        runAnalysisAndRender(); // 筛选变化，重新分析并渲染
    });

    // (新增) 科目配置模态窗
    configSubjectsBtn.addEventListener('click', () => {
        populateSubjectConfigModal(); // 打开时，用当前 G_SubjectConfigs 填充
        modal.style.display = 'flex';
    });
    modalCloseBtn.addEventListener('click', () => {
        modal.style.display = 'none';
    });
    modalSaveBtn.addEventListener('click', () => {
        saveSubjectConfigsFromModal(); // 保存配置到 G_SubjectConfigs
        modal.style.display = 'none';
        runAnalysisAndRender(); // 配置变化，重新分析并渲染
    });

    // (新增) 监听窗口大小变化，重绘 ECharts
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
    compareUploadLabel.classList.add('disabled');
    navLinks.forEach(link => {
        if (!link.classList.contains('active')) {
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

    const label = (type === 'main') ? fileUploader.previousElementSibling : compareUploadLabel;
    label.innerHTML = "🔄 正在解析...";

    try {
        const data = await loadExcelData(file); // 智能解析器
        const rankedData = addSubjectRanksToData(data); // 添加单科排名

        if (type === 'main') {
            G_StudentsData = rankedData;
            localStorage.setItem('G_StudentsData', JSON.stringify(G_StudentsData));
            // (新增) 填充班级筛选
            populateClassFilter(G_StudentsData);

            // 解锁 UI
            welcomeScreen.style.display = 'none';
            compareUploadLabel.classList.remove('disabled');
            navLinks.forEach(l => l.classList.remove('disabled'));
            classFilterContainer.style.display = 'block';
            classFilterHr.style.display = 'block';

            // 运行分析
            runAnalysisAndRender();
        } else {
            G_CompareData = rankedData;
            localStorage.setItem('G_CompareData', JSON.stringify(G_CompareData));
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
 *
 * @param {File} file - 用户上传的Excel或CSV文件对象。
 * @returns {Promise<Array<Object>>} - 解析后的学生数据数组。
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

                // header: 1 返回数组的数组，defval: "" 将空单元格转为空字符串
                const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });

                if (rawData.length < 3) {
                    return reject(new Error("文件数据不完整，至少需要2行表头和1行数据。"));
                }

                // --- 🚀 智能定位表头行 ---
                let metricRowIndex = -1;
                // 定义寻找指标行的关键字段
                const REQUIRED_METRICS = ["自定义考号", "姓名", "得分", "班次"];

                // 遍历原始数据的前几行（最多前5行），寻找指标行
                for (let i = 1; i < Math.min(rawData.length, 5); i++) {
                    // 清理当前行数据，便于精确匹配
                    const row = rawData[i].map(String).map(s => s.trim());

                    // 如果这一行包含至少两个关键指标，我们认定它是指标行
                    const foundCount = REQUIRED_METRICS.filter(metric => row.includes(metric)).length;

                    // 要求找到 '得分' 且找到至少一个定位字段 ('自定义考号', '姓名', '班次')
                    if (foundCount >= 2 && row.includes("得分")) {
                        metricRowIndex = i;
                        break;
                    }
                }

                if (metricRowIndex === -1) {
                    return reject(new Error("无法自动识别指标行。请确保表头包含 '自定义考号', '姓名', '得分', '班次'等关键字段。"));
                }

                // 确定科目行（指标行的上一行）和数据开始行
                const subjectRowIndex = metricRowIndex - 1;
                const studentDataStartRow = metricRowIndex + 1;

                // 科目行：可能存在（两级表头）或不存在（一级表头或大标题）
                const subjectHeader = (subjectRowIndex >= 0) ?
                    rawData[subjectRowIndex].map(String).map(s => s.trim()) :
                    [];
                // 指标行
                const metricHeader = rawData[metricRowIndex].map(String).map(s => s.trim());
                // --- 🚀 智能定位表头行 END ---


                const colMap = {};
                let currentSubject = "";
                const headerLength = metricHeader.length;
                const dynamicSubjectList = [];

                // 2. 核心：动态构建列映射 (colMap)
                for (let i = 0; i < headerLength; i++) {
                    const subject = String(subjectHeader[i] || "").trim(); // 科目行
                    const metric = metricHeader[i]; // 指标行

                    // --- 🚀 修正点：同时在 subjectHeader 和 metricHeader 中寻找基础字段 ---

                    // A. 识别固定字段并重置 currentSubject (强化隔离)
                    // 只要 subject 或 metric 中有一个匹配，就认为是基础信息列
                    const isID = subject === "自定义考号" || metric === "自定义考号";
                    const isName = subject === "姓名" || metric === "姓名";
                    const isClass = subject === "班级" || metric === "班级";

                    if (isID) {
                        colMap[i] = "id";
                        currentSubject = "";
                        continue;
                    } else if (isName) {
                        colMap[i] = "name";
                        currentSubject = "";
                        continue;
                    } else if (isClass) {
                        // 注意：这里我们只用 '班级' 作为 key，即使它在 metricHeader 行是空的，
                        // 只要 subjectHeader[i] 是 '班级' 就能被识别。
                        colMap[i] = "class";
                        currentSubject = "";
                        continue;
                    }

                    // B. 追踪科目名（保持不变）
                    // 只有当 subjectHeader[i] 有值时，才更新 currentSubject。
                    if (subject !== "") {
                        currentSubject = subject;
                    }

                    // C. 识别总分字段
                    if (currentSubject === "总分") {
                        if (metric === "得分") colMap[i] = "totalScore";
                        if (metric === "班次") colMap[i] = "rank";
                        if (metric === "校次") colMap[i] = "gradeRank";
                    }

                    // D. 识别各科得分字段
                    else if (metric === "得分" && currentSubject !== "") {
                        const isBasicField = ["总分", "自定义考号", "姓名", "班级"].includes(currentSubject);

                        if (!isBasicField) {
                            colMap[i] = `scores.${currentSubject}`;

                            if (!dynamicSubjectList.includes(currentSubject)) {
                                dynamicSubjectList.push(currentSubject);
                            }
                        }
                    }
                }

                // 3. 校验关键字段
                const requiredKeys = ["id", "name", "class", "totalScore", "rank"];
                const foundKeys = Object.values(colMap);
                const missingKeys = requiredKeys.filter(key => !foundKeys.includes(key));

                if (missingKeys.length > 0) {
                    console.warn("解析器映射 (缺失键): ", missingKeys);
                    return reject(new Error(`无法自动解析表头。文件缺少关键字段: ${missingKeys.join(', ')}。请确保表头包含 '自定义考号', '姓名', '班级', '总分'列下的'得分'和'班次'。`));
                }

                // 4. 处理数据行
                const studentRows = rawData.slice(studentDataStartRow); // 从定位到的数据开始行切片
                const processedData = [];

                for (const row of studentRows) {
                    // 跳过空白行
                    if (!String(row[Object.keys(colMap)[0]] || "").trim() && !String(row[Object.keys(colMap)[1]] || "").trim()) continue;

                    const student = { scores: {} };

                    for (const colIndex in colMap) {
                        const key = colMap[colIndex];
                        const rawValue = row[colIndex];

                        // 数值转换和清洗
                        if (key.startsWith("scores.")) {
                            const subject = key.split('.')[1];
                            const cleanScore = parseFloat(rawValue);
                            student.scores[subject] = isNaN(cleanScore) ? null : cleanScore;
                        } else if (key === "totalScore") {
                            const cleanTotal = parseFloat(rawValue);
                            student.totalScore = isNaN(cleanTotal) ? null : cleanTotal;
                        } else if (key === "rank" || key === "gradeRank") {
                            // 排名转换为整数 (如果不是数字，设为 0)
                            const cleanRank = parseInt(rawValue);
                            student[key] = isNaN(cleanRank) ? 0 : cleanRank;
                        } else {
                            // 考号、姓名、班级等字段
                            student[key] = String(rawValue || "").trim();
                        }
                    }

                    if (student.id) { // 仅添加有考号的有效行
                        processedData.push(student);
                    }
                }

                if (processedData.length === 0) {
                    return reject(new Error("文件解析成功，但没有找到有效的学生数据行。"));
                }

                resolve(processedData);

            } catch (err) {
                console.error(err);
                // 确保即使内部解析错误，也能返回友好的提示
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

    SUBJECT_LIST.forEach(subjectName => {
        const sortedBySubject = [...dataWithRanks].sort((a, b) => {
            const scoreA = a.scores[subjectName] || -Infinity;
            const scoreB = b.scores[subjectName] || -Infinity;
            return scoreB - scoreA;
        });

        sortedBySubject.forEach((student, index) => {
            if (!student.ranks) student.ranks = {};
            student.ranks[subjectName] = index + 1;
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
    let totalFull = 0, totalPass = 0, totalExcel = 0;

    SUBJECT_LIST.forEach(subjectName => {
        const config = G_SubjectConfigs[subjectName];
        if (!config) return; // 如果配置不存在，跳过

        const subjectScores = studentsData
            .map(s => s.scores[subjectName])
            .filter(score => typeof score === 'number' && !isNaN(score))
            .sort((a, b) => a - b);

        stats[subjectName] = calculateStatsForScores(subjectScores, config.full, config.pass, config.excel);
        stats[subjectName].name = subjectName;

        // 累加总分配置
        totalFull += config.full;
        totalPass += config.pass;
        totalExcel += config.excel;
    });

    // 2. 统计 '总分' (totalScore)
    const totalScores = studentsData.map(s => s.totalScore).filter(score => typeof score === 'number' && !isNaN(score)).sort((a, b) => a - b);
    stats['totalScore'] = calculateStatsForScores(totalScores, totalFull, totalPass, totalExcel);
    stats['totalScore'].name = '总分';

    return stats;
}

/**
 * (重构) 6.4. 辅助函数：计算单个分数数组的统计值
 * [!!] 已新增 "difficulty" 字段
 */
function calculateStatsForScores(scores, fullMark, passLine, excellentLine) {
    const count = scores.length;
    if (count === 0) return { average: 0, max: 0, min: 0, median: 0, passRate: 0, excellentRate: 0, count: 0, variance: 0, stdDev: 0, difficulty: 0, scores: [] };

    const total = scores.reduce((acc, score) => acc + score, 0);
    const average = total / count;
    const max = scores[count - 1];
    const min = scores[0];

    const mid = Math.floor(count / 2);
    const median = count % 2 === 0 ? (scores[mid - 1] + scores[mid]) / 2 : scores[mid];

    const variance = (count > 0) ? scores.reduce((acc, score) => acc + Math.pow(score - average, 2), 0) / count : 0;
    const stdDev = (count > 0) ? Math.sqrt(variance) : 0;

    // [!!] (新增) 难度系数 (平均分 / 满分)
    const difficulty = (fullMark > 0) ? parseFloat((average / fullMark).toFixed(2)) : 0;

    const passCount = scores.filter(s => s >= passLine).length;
    const excellentCount = scores.filter(s => s >= excellentLine).length;

    return {
        count: count,
        average: parseFloat(average.toFixed(2)),
        max: max,
        min: min,
        median: median,
        passRate: parseFloat(((passCount / count) * 100).toFixed(2)),
        excellentRate: parseFloat(((excellentCount / count) * 100).toFixed(2)),
        variance: parseFloat(variance.toFixed(2)),
        stdDev: parseFloat(stdDev.toFixed(2)),
        difficulty: difficulty, // [!!] (新增) 
        scores: scores // 保留原始数组，用于直方图
    };
}

// ---------------------------------
// 7. 模块渲染 (Routing)
// ---------------------------------

/**
 * (新增) 7.1. 核心分析与渲染触发器
 */
function runAnalysisAndRender() {
    if (G_StudentsData.length === 0) return; // 防止在没数据时运行

    // 1. (新增) 根据班级筛选
    const currentFilter = classFilterSelect.value;
    let activeData = G_StudentsData;
    let activeCompareData = G_CompareData;

    if (currentFilter !== 'ALL') {
        activeData = G_StudentsData.filter(s => s.class === currentFilter);

        if (G_CompareData.length > 0) {
            activeCompareData = G_CompareData.filter(s => s.class === currentFilter);
        }
    }

    // 2. (重构) 重新计算统计数据
    G_Statistics = calculateAllStatistics(activeData);
    if (activeCompareData.length > 0) {
        G_CompareStatistics = calculateAllStatistics(activeCompareData);
    }

    // 3. (重构) 渲染当前激活的模块
    const currentModule = document.querySelector('.nav-link.active').dataset.module;
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
            renderWeakness(container, activeData);
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
    SUBJECT_LIST.forEach(subject => {
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
    SUBJECT_LIST.forEach(subject => {
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

    // 1. 渲染 KPI 卡片 (保持不变)
    container.innerHTML = `
        <h2>模块一：班级整体分析 (当前筛选: ${G_CurrentClassFilter})</h2>
        <div class="kpi-grid">
            <div class="kpi-card"><h3>总分平均分</h3><div class="value">${totalStats.average || 0}</div></div>
            <div class="kpi-card"><h3>总分最高分</h3><div class="value">${totalStats.max || 0}</div></div>
            <div class="kpi-card"><h3>总分中位数</h3><div class="value">${totalStats.median || 0}</div></div>
            <div class="kpi-card"><h3>总分及格率 (%)</h3><div class="value">${totalStats.passRate || 0}</div></div>
            <div class="kpi-card"><h3>总分优秀率 (%)</h3><div class="value">${totalStats.excellentRate || 0}</div></div>
            <div class="kpi-card"><h3>考试人数</h3><div class="value">${totalStats.count || 0}</div></div>
            <div class="kpi-card"><h3>总人数</h3><div class="value">${totalStats.count || 0}</div></div>
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
                            <th>及格率 (%)</th>
                            <th>优秀率 (%)</th>
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
                            <td>${stats.totalScore.passRate}</td>
                            <td>${stats.totalScore.excellentRate}</td>
                            <td>${stats.totalScore.stdDev || 0}</td>
                        </tr>
                        ${SUBJECT_LIST.map(subject => stats[subject]).filter(s => s).map(s => `
                            <tr>
                                <td><strong>${s.name}</strong></td>
                                <td>${s.count}</td>
                                <td>${s.average}</td>
                                <td>${s.max}</td>
                                <td>${s.median}</td>
                                <td>${s.passRate}</td>
                                <td>${s.excellentRate}</td>
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
                        ${SUBJECT_LIST.map(s => `<option value="${s}">${s}</option>`).join('')}
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
                        ${SUBJECT_LIST.map(s => `<option value="${s}">${s}</option>`).join('')}
                    </select>
                    <label for="scatter-y-subject">Y轴:</label>
                    <select id="scatter-y-subject" class="sidebar-select">
                        ${SUBJECT_LIST.map((s, i) => `<option value="${s}" ${i === 1 ? 'selected' : ''}>${s}</option>`).join('')}
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
            const fullScore = SUBJECT_LIST.reduce((sum, key) => sum + (G_SubjectConfigs[key]?.full || 0), 0);
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
    renderSubjectBoxPlot('subject-boxplot-chart', G_Statistics);
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
                            <th>科目排名 (变化)</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr class="total-score-row">
                            <td><strong>总分</strong></td>
                            <td>
                                <strong>${student.totalScore}</strong>
                                ${(oldStudent && scoreDiff !== 'N/A') ? `<span class="${scoreDiff > 0 ? 'progress' : scoreDiff < 0 ? 'regress' : ''}">(${scoreDiff > 0 ? '▲' : '▼'} ${Math.abs(scoreDiff)})</span>` : ''}
                            </td>
                            <td>
                                <strong>${student.rank}</strong>
                                ${(oldStudent && rankDiff !== 'N/A') ? `<span class="${rankDiff > 0 ? 'progress' : rankDiff < 0 ? 'regress' : ''}">(${rankDiff > 0 ? '▲' : '▼'} ${Math.abs(rankDiff)})</span>` : ''}
                            </td>
                        </tr>
                        
                        ${SUBJECT_LIST.map(subject => {
            let subjectScoreDiff = 'N/A';
            let subjectRankDiff = 'N/A';

            if (oldStudent && oldStudent.scores && oldStudent.ranks) {
                const oldScore = oldStudent.scores[subject] || 0;
                const newScore = student.scores[subject] || 0;
                if (oldScore !== 0 || newScore !== 0) {
                    subjectScoreDiff = (newScore - oldScore).toFixed(2);
                }

                const oldRank = oldStudent.ranks[subject] || 0;
                const newRank = student.ranks[subject] || 0;
                if (oldRank > 0 && newRank > 0) {
                    subjectRankDiff = oldRank - newRank;
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
                                    ${student.ranks[subject] || 'N/A'}
                                    ${(oldStudent && subjectRankDiff !== 'N/A') ? `<span class="${subjectRankDiff > 0 ? 'progress' : subjectRankDiff < 0 ? 'regress' : ''}">(${subjectRankDiff > 0 ? '▲' : '▼'} ${Math.abs(subjectRankDiff)})</span>` : ''}
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
                    ${SUBJECT_LIST.map(s => `<option value="${s}">${s}</option>`).join('')}
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
            fullScore = SUBJECT_LIST.reduce((sum, key) => sum + (G_SubjectConfigs[key]?.full || 0), 0);
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
 * 9.4. 模块四：成绩趋势对比
 * [!!] 已修改：删除 "进退步一览" 图，布局变为 1x1
 * [!!] (已合并) "年排" 列, "姓名/考号" 排序, "学生进退步条形图"
 */
function renderTrend(container, currentData, compareData) {

    if (!compareData || compareData.length === 0) {
        container.innerHTML = `<h2>模块四：成绩趋势对比 (当前筛选: ${G_CurrentClassFilter})</h2><p>请先在侧边栏导入 "对比成绩" 数据。</p>`;
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
        const scatterData = (classFilter === 'ALL')
            ? mergedData
            : mergedData.filter(s => s.class === classFilter);

        // [!!] (修改) 只调用条形图
        renderRankChangeBarChart('trend-rank-change-bar-chart', scatterData);
    };

    // 5. (重构) 渲染基础HTML
    container.innerHTML = `
        <h2>模块四：成绩趋势对比 (当前筛选: ${G_CurrentClassFilter})</h2>

        <div class="main-card-wrapper" style="margin-bottom: 20px;">
            <div class="controls-bar chart-controls">
                <label for="trend-class-filter">班级:</label>
                <select id="trend-class-filter" class="sidebar-select">
                    <option value="ALL">-- 全体年段 --</option>
                    ${[...new Set(currentData.map(s => s.class))].sort().map(c => `<option value="${c}">${c}</option>`).join('')}
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

    searchInput.addEventListener('input', drawTable);
    classFilterSelect.addEventListener('change', drawCharts);

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
        <h2>模块五：学生分层筛选 (当前筛选: ${G_CurrentClassFilter})</h2>
        
        <div class="main-card-wrapper" style="margin-bottom: 20px;">
            <div class="controls-bar" style="background: transparent; box-shadow: none; padding: 0; margin-bottom: 0; flex-wrap: wrap;">
                <label for="group-subject">筛选科目:</label>
                <select id="group-subject" class="sidebar-select">
                    <option value="totalScore">总分</option>
                    ${SUBJECT_LIST.map(s => `<option value="${s}">${s}</option>`).join('')}
                </select>
                <label for="group-min">分数 > </label>
                <input type="number" id="group-min" placeholder="最低分" value="0">
                <label for="group-max">分数 < </label>
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
                const full = SUBJECT_LIST.reduce((sum, key) => sum + (G_SubjectConfigs[key]?.full || 0), 0);
                const excel = SUBJECT_LIST.reduce((sum, key) => sum + (G_SubjectConfigs[key]?.excel || 0), 0);
                const good = SUBJECT_LIST.reduce((sum, key) => sum + (G_SubjectConfigs[key]?.good || 0), 0);
                const pass = SUBJECT_LIST.reduce((sum, key) => sum + (G_SubjectConfigs[key]?.pass || 0), 0);
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
        <h2>模块六：学科关联矩阵 (当前筛选: ${G_CurrentClassFilter})</h2>
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
function renderWeakness(container, activeData) {
    // 1. 渲染基础 HTML
    container.innerHTML = `
        <h2>模块七：学生偏科诊断 (当前筛选: ${G_CurrentClassFilter})</h2>
        <p style="margin-top: -20px; margin-bottom: 20px; color: var(--text-muted);">
            分析学生的“内部弱势”，即该学生某科的得分率远低于他自己的平均得分率。
        </p>

        <div class="main-card-wrapper" style="margin-bottom: 20px;">
            <div class="controls-bar chart-controls">
                <h4 style="margin:0;">偏科程度四象限图(右上 (高分-高偏科)：“尖子生但有短板” (重点关注)；右下 (高分-低偏科)：“学霸/全能型”；左上 (低分-高偏科)：“基础差且有极大短板”；左下 (低分-低偏科)：“基础薄弱但各科‘均衡’的差”)</h4>
            </div>
            <div class="chart-container" id="weakness-scatter-chart" style="width: 100%; height: 500px;"></div>
        </div>

        <div class="main-card-wrapper">
            <div class="controls-bar chart-controls">
                <h4 style="margin:0;">“短板”学生列表</h4>
                <span style="font-size: 0.8em; color: var(--text-muted);">(按“偏离度”降序，仅显示偏离度 < -10% 的学生)</span>
            </div>
            <div class="table-container" id="weakness-table-container">
                </div>
        </div>
    `;

    // 2. (核心) 计算偏科数据
    const weaknessData = calculateWeaknessData(activeData);

    // 3. 渲染图表
    renderWeaknessScatter('weakness-scatter-chart', weaknessData);

    // 4. 渲染表格
    renderWeaknessTable('weakness-table-container', weaknessData);
}

/**
 * (新增) 10.15. 渲染学科关联热力图 (Heatmap)
 */
function renderCorrelationHeatmap(elementId, activeData) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    // 1. (核心) 计算相关系数矩阵
    const subjects = SUBJECT_LIST;
    const n = subjects.length;
    const heatmapData = []; // ECharts 格式: [xIndex, yIndex, value]
    const correlationMatrix = Array(n).fill(0).map(() => Array(n).fill(0));

    // (提取所有科目的分数数组，提高效率)
    const scoresMap = {};
    subjects.forEach(subject => {
        scoresMap[subject] = activeData.map(s => s.scores[subject]).filter(s => s !== null && s !== undefined);
    });

    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            if (i === j) {
                correlationMatrix[i][j] = 1.0;
            } else if (i < j) {
                // (只计算上三角)
                // [!!] (注意：这里为了简化，没有对齐学生。理想情况应先对齐)
                // (当前的实现是基于 activeData 中提取，已自动对齐)
                const xSubject = subjects[i];
                const ySubject = subjects[j];

                // (需要先对齐两个数组，只保留都参加了考试的学生)
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
                correlationMatrix[i][j] = coeff;
                correlationMatrix[j][i] = coeff; // (矩阵对称)
            }

            heatmapData.push([
                i, // X 轴索引
                j, // Y 轴索引
                parseFloat(correlationMatrix[i][j].toFixed(2)) // 值
            ]);
        }
    }

    // 2. ECharts 配置
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
        // [!!] (核心) 视觉映射 (颜色)
        visualMap: {
            min: -1,
            max: 1,
            calculable: true,
            orient: 'horizontal',
            left: 'center',
            bottom: '5%',
            inRange: {
                // (红 -> 白 -> 蓝)
                color: ['#dc3545', '#ffffff', '#007bff']
            }
        },
        series: [{
            name: '相关系数',
            type: 'heatmap',
            data: heatmapData,
            label: {
                show: true, // (在格子上显示数字)
                formatter: (params) => params.data[2] // (显示相关系数)
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

    const indicators = SUBJECT_LIST.map(subject => {
        const full = G_SubjectConfigs[subject]?.full || 100;
        return { name: subject, max: full }; // (新增) max 动态读取配置
    });

    const averageData = SUBJECT_LIST.map(subject => {
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
    const data = SUBJECT_LIST.map(subject => {
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
 * (新增) 10.5. 渲染多科目箱形图
 * (依赖: echarts/dist/extension/dataTool.min.js)
 */
function renderSubjectBoxPlot(elementId, stats) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) echartsInstances[elementId].dispose();
    echartsInstances[elementId] = echarts.init(chartDom);

    // 1. 准备 ECharts dataTool 需要的数据
    // 格式: [ [subj1_score1, subj1_score2, ...], [subj2_score1, subj2_score2, ...] ]
    const allScores = SUBJECT_LIST.map(subject => {
        return stats[subject] ? stats[subject].scores : [];
    });

    // 2. 使用 dataTool 计算 (index.html 中已引入 dataTool.min.js)
    const boxplotData = echarts.dataTool.prepareBoxplotData(allScores);

    const option = {
        title: {
            // text: '各科分数分布 (箱形图)', (已在HTML中添加)
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
            data: SUBJECT_LIST,
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
                data: boxplotData.boxData,
                tooltip: {
                    formatter: function (param) {
                        // param.data[0] 是 xAxis 索引
                        return [
                            '<strong>' + SUBJECT_LIST[param.data[0]] + '</strong>',
                            '最大值: ' + param.data[5],
                            '上四分位 (Q3): ' + param.data[4],
                            '中位数 (Q2): ' + param.data[3],
                            '下四分位 (Q1): ' + param.data[2],
                            '最小值: ' + param.data[1]
                        ].join('<br/>');
                    }
                }
            },
            {
                name: '异常值',
                type: 'scatter',
                data: boxplotData.outliers
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

    const categories = SUBJECT_LIST;

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
    const indicators = SUBJECT_LIST.map(subject => {
        return { name: subject, max: 100 };
    });

    // 2. 计算 "学生得分率"
    const studentData = SUBJECT_LIST.map(subject => {
        const score = student.scores[subject] || 0;
        const full = G_SubjectConfigs[subject]?.full;
        if (!full || full === 0) return 0; // 避免除以零
        return parseFloat(((score / full) * 100).toFixed(1));
    });

    // 3. 计算 "年级平均得分率"
    const averageData = SUBJECT_LIST.map(subject => {
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
    const scatterData = SUBJECT_LIST.map(subject => {
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
function renderRankChangeBarChart(elementId, students) {
    const chartDom = document.getElementById(elementId);
    if (!chartDom) return;

    if (echartsInstances[elementId]) {
        echartsInstances[elementId].dispose();
    }
    echartsInstances[elementId] = echarts.init(chartDom);

    // 1. 过滤掉没有对比数据的学生
    const data = students.filter(s => s.oldRank !== null);

    // 2. 按 "学生姓名" 排序
    data.sort((a, b) => a.name.localeCompare(b.name));

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
function calculateWeaknessData(students) {

    // (辅助函数)
    const mean = (arr) => {
        if (!arr || arr.length === 0) return 0;
        return arr.reduce((sum, val) => sum + val, 0) / arr.length;
    };
    const stdDev = (arr, meanVal) => {
        if (!arr || arr.length < 2) return 0;
        return Math.sqrt(arr.reduce((sum, val) => sum + Math.pow(val - meanVal, 2), 0) / arr.length);
    };

    const results = [];

    students.forEach(student => {
        // 1. 计算该生的所有 "得分率"
        const percents = [];
        const validSubjects = [];
        SUBJECT_LIST.forEach(subject => {
            const config = G_SubjectConfigs[subject];
            const score = student.scores[subject];
            // (必须有分数 且 满分不为0)
            if (config && config.full > 0 && score !== null && score !== undefined) {
                percents.push((score / config.full) * 100);
                validSubjects.push(subject);
            }
        });

        if (percents.length < 2) {
            results.push(null); // (数据不足，无法分析偏科)
            return;
        }

        // 2. 计算该生的 "平均得分率" 和 "偏科标准差"
        const avgPercent = mean(percents);
        const stdDevPercent = stdDev(percents, avgPercent);

        // 3. 计算每科的 "偏离度"
        const subjectDeviations = [];
        percents.forEach((percent, index) => {
            const subject = validSubjects[index];
            subjectDeviations.push({
                subject: subject,
                percent: parseFloat(percent.toFixed(1)),
                deviation: parseFloat((percent - avgPercent).toFixed(1))
            });
        });

        results.push({
            student: student,
            avgPercent: parseFloat(avgPercent.toFixed(1)),
            stdDevPercent: parseFloat(stdDevPercent.toFixed(1)),
            subjectDeviations: subjectDeviations
        });
    });

    return results.filter(r => r !== null); // 过滤掉无法分析的学生
}


/**
 * (最终修复版 V4 - 完美版) 解决 MarkLine、四色渲染、queryComponents 错误，并实现 X 轴动态缩放。
 */
function renderWeaknessScatter(elementId, weaknessData) {
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

    // 1. 计算平均线
    const yValues = weaknessData.map(d => d.stdDevPercent).filter(v => typeof v === 'number' && !isNaN(v));
    const avgStdDev = mean(yValues); 

    let avgScoreLine = 65; 
    if (G_Statistics && G_Statistics.totalScore && 
        G_Statistics.totalScore.average !== undefined && 
        G_Statistics.totalScore.difficulty > 0) 
    {
        let calculatedAvg = G_Statistics.totalScore.average / G_Statistics.totalScore.difficulty;
        if (!isNaN(calculatedAvg) && calculatedAvg > 40 && calculatedAvg < 90) {
            avgScoreLine = calculatedAvg;
        }
    }
    
    // 2. 数据预处理
    const quadrantData = { '右上': [], '左上': [], '右下': [], '左下': [] };
    const xValuesRaw = [];
    const yValuesRaw = [];

    weaknessData.forEach(data => {
        const x = data.avgPercent;
        const y = data.stdDevPercent;
        const studentName = data.student.name;

        if (typeof x !== 'number' || isNaN(x) || typeof y !== 'number' || isNaN(y)) return; 

        xValuesRaw.push(x);
        yValuesRaw.push(y);

        const quadrantKey = (x >= avgScoreLine ? '右' : '左') + (y >= avgStdDev ? '上' : '下');
        quadrantData[quadrantKey].push([x, y, studentName]);
    });

    // 3. 🚀 动态计算坐标轴范围 (包含最小值)
    const min_X = xValuesRaw.length > 0 ? Math.min(...xValuesRaw) : 0;
    const max_X = xValuesRaw.length > 0 ? Math.max(...xValuesRaw) : 80;
    const max_Y = yValuesRaw.length > 0 ? Math.max(...yValuesRaw) : 18;
    
    // X 轴最小值: 略微留白，向下取整到最近的 5 的倍数
    const dynamicMinX = Math.floor(Math.max(0, min_X * 0.95) / 5) * 5; 
    
    // X, Y 轴最大值 (确保容纳 avgScoreLine 并向上取整)
    const neededMaxX = Math.max(max_X, avgScoreLine * 1.05); 
    const dynamicMaxX = Math.ceil(neededMaxX * 1.05 / 5) * 5; 
    const dynamicMaxY = Math.ceil(max_Y * 1.10 / 5) * 5; 

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
        title: { text: '学生能力-均衡度 四象限图', left: 'center', textStyle: { fontSize: 16, fontWeight: 'normal' } },
        tooltip: {
            trigger: 'item',
            formatter: (params) => {
                if (params.componentType === 'graphic') return '';
                const data = params.data;
                return `<strong>${data[2]}</strong><br/>` +
                    `平均得分率 (能力): ${data[0].toFixed(2)}%<br/>` +
                    `偏科标准差 (均衡): ${data[1].toFixed(2)}%`;
            }
        },
        grid: { left: '10%', right: '10%', bottom: '10%', top: '10%' },
        xAxis: { 
            type: 'value', 
            name: '综合能力 (平均得分率 %)', 
            nameLocation: 'middle', 
            nameGap: 30, 
            min: dynamicMinX, // 🚀 应用动态最小值
            max: dynamicMaxX 
        },
        yAxis: { type: 'value', name: '偏科程度 (标准差)', nameLocation: 'middle', nameGap: 40, min: 0, max: dynamicMaxY },
        
        series: [
            // 四个散点图系列 (保持不变)
            { name: '右上象限', type: 'scatter', data: quadrantData['右上'], symbolSize: 8, itemStyle: { opacity: 0.7, color: quadrantColors['右上'] } },
            { name: '左上象限', type: 'scatter', data: quadrantData['左上'], symbolSize: 8, itemStyle: { opacity: 0.7, color: quadrantColors['左上'] } },
            { name: '右下象限', type: 'scatter', data: quadrantData['右下'], symbolSize: 8, itemStyle: { opacity: 0.7, color: quadrantColors['右下'] } },
            { name: '左下象限', type: 'scatter', data: quadrantData['左下'], symbolSize: 8, itemStyle: { opacity: 0.7, color: quadrantColors['左下'] } },
            
            // 辅助 MarkLine 系列 (保持不变)
            {
                name: '辅助线', type: 'scatter', data: [], 
                markLine: {
                    silent: true, animation: false, symbol: 'none',
                    lineStyle: { type: 'dashed', color: 'red' }, 
                    data: [
                        { xAxis: avgScoreLine, name: '平均能力线', label: { formatter: '平均能力' } },
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
        // 🚀 使用修正后的 dynamicMinX/Max 来定位
        const quadrantPositions = {
            '右上': [avgScoreLine + (dynamicMaxX - avgScoreLine) * 0.5, avgStdDev + (dynamicMaxY - avgStdDev) * 0.5],
            '左上': [dynamicMinX + (avgScoreLine - dynamicMinX) * 0.5, avgStdDev + (dynamicMaxY - avgStdDev) * 0.5], // 修正左侧定位
            '右下': [avgScoreLine + (dynamicMaxX - avgScoreLine) * 0.5, avgStdDev * 0.5],
            '左下': [dynamicMinX + (avgScoreLine - dynamicMinX) * 0.5, avgStdDev * 0.5] // 修正左侧定位
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

    // 1. (核心) 创建一个 "短板" 的扁平列表
    const flatList = [];
    weaknessData.forEach(data => {
        data.subjectDeviations.forEach(sub => {
            // [!!] 我们只关心 "偏离度" 小于 -10% 的严重短板
            if (sub.deviation < -10) {
                flatList.push({
                    name: data.student.name,
                    id: data.student.id,
                    subject: sub.subject,
                    subjectPercent: sub.percent,
                    avgPercent: data.avgPercent,
                    deviation: sub.deviation
                });
            }
        });
    });

    // 2. 按“偏离度”升序排序 (最弱的在最前面)
    flatList.sort((a, b) => a.deviation - b.deviation);

    // 3. 渲染 HTML
    let html = ``;
    if (flatList.length === 0) {
        html = `<p style="text-align: center; padding: 20px; color: var(--text-muted);">未发现严重偏科的学生 (偏离度 < -10%)。</p>`;
    } else {
        html = `
            <table>
                <thead>
                    <tr>
                        <th>学生姓名</th>
                        <th>弱势科目</th>
                        <th>偏离度 (该科-均分)</th>
                        <th>该科得分率</th>
                        <th>学生平均得分率</th>
                    </tr>
                </thead>
                <tbody>
                    ${flatList.map(item => `
                        <tr>
                            <td><strong>${item.name}</strong> (${item.id})</td>
                            <td><strong>${item.subject}</strong></td>
                            <td><strong class="regress">${item.deviation}%</strong></td>
                            <td>${item.subjectPercent}%</td>
                            <td>${item.avgPercent}%</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }
    tableContainer.innerHTML = html;
}

/**
 * (新增) 11. 启动时从 localStorage 加载数据
 */
function loadDataFromStorage() {
    // 1. 尝试读取已存储的数据
    const storedData = localStorage.getItem('G_StudentsData');
    const storedCompareData = localStorage.getItem('G_CompareData');
    const storedConfigs = localStorage.getItem('G_SubjectConfigs');

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

    // (重要) 恢复上次保存的“科目配置”
    if (storedConfigs) {
        G_SubjectConfigs = JSON.parse(storedConfigs);
    }

    // 4. (关键) 运行所有启动程序，就像刚上传了文件一样

    // (填充) 填充班级筛选
    populateClassFilter(G_StudentsData);

    // (解锁) 解锁 UI
    welcomeScreen.style.display = 'none';
    compareUploadLabel.classList.remove('disabled');
    navLinks.forEach(l => l.classList.remove('disabled'));
    classFilterContainer.style.display = 'block';
    classFilterHr.style.display = 'block';

    // (运行) 运行分析
    runAnalysisAndRender();

    console.log("数据加载并分析完毕！");
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
    const indicators = SUBJECT_LIST.map(subject => {
        // (动态获取最大值, 0.8 左右是比较好的最大值)
        const max = Math.max(
            totalStats[subject]?.difficulty || 0,
            groupStats[subject]?.difficulty || 0
        );
        return { name: subject, max: Math.max(1.0, Math.ceil(max * 10) / 10) };
    });

    // 3. (新增) 获取 "筛选群体" 的得分率 (即难度)
    const groupData = SUBJECT_LIST.map(subject => {
        return groupStats[subject]?.difficulty || 0;
    });

    // 4. (新增) 获取 "全体平均" 的得分率 (即难度)
    const totalData = SUBJECT_LIST.map(subject => {
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