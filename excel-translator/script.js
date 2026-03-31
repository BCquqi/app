// script.js - 完整的翻译、Excel操作与交互逻辑
(function() {
    // DOM 元素
    const excelInput = document.getElementById('excel-input');
    const fileNameSpan = document.getElementById('file-name');
    const resetBtn = document.getElementById('reset-data-btn');
    const exportBtn = document.getElementById('export-btn');
    const executeBtn = document.getElementById('execute-translate-btn');
    const sourceColInput = document.getElementById('source-col');
    const targetColInput = document.getElementById('target-col');
    const sourceLangSelect = document.getElementById('source-lang');
    const targetLangSelect = document.getElementById('target-lang');
    const tablePreviewDiv = document.getElementById('table-preview');
    const dimensionSpan = document.getElementById('data-dimension');
    const operationLogDiv = document.getElementById('operation-log');
    const progressInfoDiv = document.getElementById('progress-info');

    // 核心数据
    let originalData = [];     // 原始二维数组（深拷贝基准）
    let currentData = [];      // 当前编辑/展示的数据
    let isProcessing = false;   // 防止并发翻译

    // 辅助函数 - 更新预览表格
    function renderTable() {
        if (!currentData || currentData.length === 0) {
            tablePreviewDiv.innerHTML = '<div class="placeholder-text">📭 暂无数据，请先上传 Excel 文件</div>';
            dimensionSpan.textContent = '无数据';
            return;
        }
        const maxRows = Math.min(currentData.length, 200);
        const maxCols = currentData[0] ? Math.min(currentData[0].length, 30) : 0;
        let html = '<div style="overflow-x: auto;"><table style="min-width: 100%;">';
        // 表头 (列号标识)
        html += '<thead><tr>';
        for (let c = 0; c < maxCols; c++) {
            html += `<th style="background:#f1f5f9;">第${c+1}列</th>`;
        }
        html += '</tr></thead><tbody>';
        for (let r = 0; r < maxRows; r++) {
            html += '<tr>';
            for (let c = 0; c < maxCols; c++) {
                let cellVal = (currentData[r][c] !== undefined && currentData[r][c] !== null) ? currentData[r][c] : '';
                let display = String(cellVal).length > 50 ? String(cellVal).slice(0, 47) + '...' : String(cellVal);
                html += `<td title="${escapeHtml(String(cellVal))}">${escapeHtml(display)}</td>`;
            }
            html += '</tr>';
        }
        html += '</tbody></table></div>';
        if (currentData.length > 200) html += `<div style="padding:0.5rem; text-align:center; background:#faf9fe;">仅展示前200行，共 ${currentData.length} 行</div>`;
        tablePreviewDiv.innerHTML = html;
        dimensionSpan.textContent = `${currentData.length} 行 × ${currentData[0]?.length || 0} 列`;
    }

    // 简易防XSS
    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/[&<>]/g, function(m) {
            if (m === '&') return '&amp;';
            if (m === '<') return '&lt;';
            if (m === '>') return '&gt;';
            return m;
        }).replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, function(c) {
            return c;
        });
    }

    // 添加操作日志
    function addLog(message, isWarning = false) {
        const logItem = document.createElement('div');
        logItem.className = `log-item ${isWarning ? 'warning' : ''}`;
        const time = new Date().toLocaleTimeString();
        logItem.innerHTML = `[${time}] ${escapeHtml(message)}`;
        operationLogDiv.appendChild(logItem);
        if (operationLogDiv.children.length > 30) {
            operationLogDiv.removeChild(operationLogDiv.children[0]);
        }
        const emptyHint = operationLogDiv.querySelector('.log-empty');
        if (emptyHint) emptyHint.remove();
        operationLogDiv.scrollTop = operationLogDiv.scrollHeight;
    }

    // 显示/隐藏进度信息
    function setProgressText(text, show = true) {
        if (show && text) {
            progressInfoDiv.style.display = 'flex';
            progressInfoDiv.innerHTML = `<span>⏳</span><span>${escapeHtml(text)}</span>`;
        } else if (!show) {
            progressInfoDiv.style.display = 'none';
        } else {
            progressInfoDiv.style.display = 'flex';
            progressInfoDiv.innerHTML = `<span>✨</span><span>${escapeHtml(text)}</span>`;
        }
    }

    // 扩展列至指定索引 (0-based)
    function ensureColumnExists(colIndex) {
        if (!currentData.length) return false;
        let maxCols = currentData[0].length;
        if (colIndex < maxCols) return true;
        // 所有行扩展
        for (let i = 0; i < currentData.length; i++) {
            while (currentData[i].length <= colIndex) {
                currentData[i].push('');
            }
        }
        addLog(`📐 目标列 ${colIndex+1} 超出原列数，已自动扩展列至 ${colIndex+1} 列`, false);
        renderTable();
        return true;
    }

    // 翻译单个文本 (调用 MyMemory 免费API)
    async function translateText(text, sourceLang, targetLang) {
        if (!text || typeof text !== 'string') return text;
        const trimmed = text.trim();
        if (trimmed === '') return text;
        // 去除过长文本限制(API限制500字符左右)
        const queryText = encodeURIComponent(trimmed.slice(0, 400));
        const langPair = `${sourceLang}|${targetLang}`;
        const url = `https://api.mymemory.translated.net/get?q=${queryText}&langpair=${langPair}&de=auto@google.com`;
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000);
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (!response.ok) throw new Error('API响应错误');
            const data = await response.json();
            let translated = data?.responseData?.translatedText;
            if (translated && translated !== trimmed) {
                // 去除可能出现的html实体
                translated = translated.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
                return translated;
            }
            return text;
        } catch (err) {
            console.warn(`翻译失败: ${text}`, err);
            addLog(`⚠️ 单词 "${text.slice(0, 30)}..." 翻译失败: ${err.message}，保留原文`, true);
            return text;
        }
    }

    // 批量翻译整列 (并发控制)
    async function translateColumn(sourceColIdx, targetColIdx, sourceLang, targetLang) {
        if (!currentData.length) throw new Error('无数据');
        if (sourceColIdx < 0 || sourceColIdx >= currentData[0].length) {
            throw new Error(`源列 ${sourceColIdx+1} 超出当前数据范围 (共 ${currentData[0].length} 列)`);
        }
        ensureColumnExists(targetColIdx);
        
        const rows = currentData.length;
        const tasks = [];
        const cellTexts = [];
        for (let i = 0; i < rows; i++) {
            let originalVal = currentData[i][sourceColIdx];
            let textToTranslate = (originalVal !== undefined && originalVal !== null) ? String(originalVal) : '';
            cellTexts.push(textToTranslate);
        }
        
        // 并发限制 (一次最多5个请求)
        const CONCURRENCY = 4;
        const results = new Array(rows).fill(null);
        let completed = 0;
        let errorFlag = false;
        
        setProgressText(`准备翻译 ${rows} 个单元格 (源语言:${sourceLang} → 目标:${targetLang})`, true);
        
        async function worker(startIdx) {
            for (let i = startIdx; i < rows; i += CONCURRENCY) {
                if (errorFlag) break;
                const txt = cellTexts[i];
                if (txt === '') {
                    results[i] = '';
                    completed++;
                    continue;
                }
                try {
                    const translated = await translateText(txt, sourceLang, targetLang);
                    results[i] = translated;
                } catch (err) {
                    errorFlag = true;
                    results[i] = txt;
                    addLog(`❌ 翻译中断: ${err.message}`, true);
                    break;
                } finally {
                    completed++;
                    if (completed % 5 === 0 || completed === rows) {
                        setProgressText(`翻译进度: ${completed}/${rows}  (${Math.round(completed/rows*100)}%)`);
                    }
                }
            }
        }
        
        const workersPromises = [];
        for (let start = 0; start < CONCURRENCY; start++) {
            workersPromises.push(worker(start));
        }
        await Promise.all(workersPromises);
        
        if (errorFlag) {
            throw new Error('翻译过程中出现错误，部分结果可能保留原文');
        }
        // 写回目标列
        for (let i = 0; i < rows; i++) {
            if (results[i] !== null) {
                currentData[i][targetColIdx] = results[i];
            }
        }
        setProgressText(`✅ 翻译完成！已更新第 ${targetColIdx+1} 列，共 ${rows} 条`, false);
        setTimeout(() => setProgressText('', false), 2000);
        return rows;
    }

    // 执行翻译操作 (封装)
    async function runTranslation() {
        if (isProcessing) {
            addLog('⏸️ 已有翻译任务进行中，请稍后', true);
            return;
        }
        if (!currentData || currentData.length === 0) {
            addLog('❌ 请先上传 Excel 文件', true);
            return;
        }
        let sourceCol = parseInt(sourceColInput.value, 10);
        let targetCol = parseInt(targetColInput.value, 10);
        const sourceLang = sourceLangSelect.value;
        const targetLang = targetLangSelect.value;
        
        if (isNaN(sourceCol) || sourceCol < 1) {
            addLog('❌ 源列号必须为正整数', true);
            return;
        }
        if (isNaN(targetCol) || targetCol < 1) {
            addLog('❌ 目标列号必须为正整数', true);
            return;
        }
        const sourceColIdx = sourceCol - 1;
        const targetColIdx = targetCol - 1;
        
        if (sourceColIdx >= currentData[0].length) {
            addLog(`❌ 源列 ${sourceCol} 超出数据最大列数 ${currentData[0].length}`, true);
            return;
        }
        
        isProcessing = true;
        executeBtn.disabled = true;
        exportBtn.disabled = true;
        resetBtn.disabled = true;
        
        try {
            const affectedRows = await translateColumn(sourceColIdx, targetColIdx, sourceLang, targetLang);
            addLog(`🌍 翻译操作: 第${sourceCol}列 (${sourceLang} → ${targetLang}) 结果写入第${targetCol}列，影响 ${affectedRows} 行`);
            renderTable();
        } catch (err) {
            addLog(`❌ 操作失败: ${err.message}`, true);
            console.error(err);
        } finally {
            isProcessing = false;
            executeBtn.disabled = false;
            exportBtn.disabled = false;
            resetBtn.disabled = false;
            // 若原始数据存在，重置按钮启用
            if (originalData.length === 0) resetBtn.disabled = true;
            else resetBtn.disabled = false;
        }
    }
    
    // 重置为原始数据
    function resetToOriginal() {
        if (!originalData.length) {
            addLog('没有可恢复的原始数据', true);
            return;
        }
        currentData = JSON.parse(JSON.stringify(originalData));
        renderTable();
        addLog('🔄 已重置数据到初始上传状态', false);
    }
    
    // 导出Excel
    function exportToExcel() {
        if (!currentData || currentData.length === 0) {
            addLog('无数据可导出', true);
            return;
        }
        try {
            const ws = XLSX.utils.aoa_to_sheet(currentData);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, '翻译结果');
            XLSX.writeFile(wb, `translated_${new Date().toISOString().slice(0,19).replace(/:/g, '-')}.xlsx`);
            addLog('📎 导出成功，文件已下载', false);
        } catch(e) {
            addLog(`导出失败: ${e.message}`, true);
        }
    }
    
    // 解析上传文件
    function handleFileUpload(file) {
        if (!file) return;
        fileNameSpan.textContent = file.name;
        const reader = new FileReader();
        reader.onload = function(e) {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: "" });
            if (!rows || rows.length === 0) {
                addLog('文件无有效数据', true);
                return;
            }
            // 标准化二维数组，保证每行列数一致
            let maxLen = 0;
            for (let r of rows) if (r.length > maxLen) maxLen = r.length;
            const normalized = rows.map(row => {
                const newRow = [...row];
                while (newRow.length < maxLen) newRow.push('');
                return newRow;
            });
            originalData = JSON.parse(JSON.stringify(normalized));
            currentData = JSON.parse(JSON.stringify(normalized));
            renderTable();
            addLog(`✅ 成功加载文件: ${file.name} (${currentData.length}行 x ${maxLen}列)`);
            exportBtn.disabled = false;
            resetBtn.disabled = false;
            // 清空旧日志可选，但保留历史
            if (operationLogDiv.children.length > 0 && operationLogDiv.querySelector('.log-empty')) {
                operationLogDiv.innerHTML = '';
            }
        };
        reader.onerror = () => addLog('文件读取失败', true);
        reader.readAsArrayBuffer(file);
    }
    
    // 上传触发
    excelInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            handleFileUpload(e.target.files[0]);
        } else {
            fileNameSpan.textContent = '未选择文件';
        }
    });
    document.querySelector('.upload-area .btn-primary').addEventListener('click', () => excelInput.click());
    
    resetBtn.addEventListener('click', resetToOriginal);
    exportBtn.addEventListener('click', exportToExcel);
    executeBtn.addEventListener('click', runTranslation);
    
    // 初始禁用相关按钮，直到上传
    function initButtons() {
        exportBtn.disabled = true;
        resetBtn.disabled = true;
        executeBtn.disabled = false; // 可以点击但会提示无数据
    }
    initButtons();
    // 当有数据后启用执行翻译时内部校验
    // 额外: 上传后启用执行按钮(已启用，但函数内会校验数据)
})();