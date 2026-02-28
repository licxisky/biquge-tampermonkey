export const modalHtml = `
<div id="fetchContentModal" style="display:none;">
  <h3>小说下载工具<span id="fetcModalClose">✕</span><span id="configBtn" title="设置">⚙️</span></h3>
  <div class="modal-body">
    <label id="_book_info"></label>
    <div class="title-selector-group">
      <label class="title-selector-label">📚 文件名标题选择</label>
      <select id="_title_select">
        <option value="">自动检测（推荐）</option>
      </select>
      <input type="text" id="_title_custom" placeholder="或输入自定义标题">
    </div>
    <label for="ranges">下载章节范围：</label>
    <table>
      <tbody>
        <colgroup><col style="width: 45%;"><col style="width: 10%;"><col style="width: 45%;"></colgroup>
        <tr>
          <th style="width:45%; text-align:right;"><input type="number" id="_startRange" min="1" value="1"></th>
          <th style="width:10%; text-align:center;"> ~ </th>
          <th style="width:45%; text-align: left;"><input type="number" id="_finalRange" min="1" value="2"></th>
        </tr>
        <tr>
          <td style="width:45%; text-align:right;" id="_startRange_title"></td>
          <td style="width:10%; text-align:center;"> ~ </td>
          <td style="width:45%; text-align:left;" id="_finalRange_title"></td>
        </tr>
      </tbody>
    </table>
    <label id="_warn_info"></label>
    <div class="button-group">
      <button id="previewButton">📖 预览章节</button>
      <button id="ruleManageButton">⚙️ 规则管理</button>
    </div>
    <button id="fetchContentButton">开始下载</button>
    <div id="fetchContentProgress"><div></div></div>
    <div id="detectionResultsContainer" style="display:none;">
      <div class="detection-title">⚠️ 内容质量检测</div>
      <div id="detectionResults"></div>
    </div>
    <div id="failedChaptersInfo" style="display:none;">
      <div class="failed-title">失败章节列表：</div>
      <div id="failedChaptersList"></div>
      <button id="retryFailedButton">重试失败章节</button>
    </div>
    <a id="_downlink"></a>
  </div>
</div>
<div id="configModal" style="display:none;">
  <h3>下载设置<span id="configModalClose" style="cursor: pointer; float: right; margin:-8px -4px;">✕</span></h3>
  <div class="modal-body">
    <div class="config-item">
      <label>并发请求数</label>
      <input type="number" id="config_concurrency" min="1" max="20" value="8">
      <small>(1-20)</small>
    </div>
    <div class="config-item">
      <label>失败重试次数</label>
      <input type="number" id="config_retries" min="0" max="10" value="3">
      <small>(0-10)</small>
    </div>
    <div class="config-item">
      <label>iframe超时(秒)</label>
      <input type="number" id="config_timeout" min="5" max="60" value="10">
      <small>(5-60)</small>
    </div>
    <div class="config-item">
      <label>最小内容长度</label>
      <input type="number" id="config_minlength" min="10" max="200" value="50">
      <small>(10-200字)</small>
    </div>
    <div class="config-item config-item-border">
      <label class="label-orange">智能限流下限</label>
      <input type="number" id="config_throttle_min" min="1" max="20" value="3">
      <small>(1-20)</small>
    </div>
    <div class="config-item">
      <label class="label-orange">智能限流上限</label>
      <input type="number" id="config_throttle_max" min="1" max="30" value="15">
      <small>(1-30)</small>
    </div>
    <div class="section-divider">
      <button id="manageCleanRulesButton">🧹 内容清洗规则管理</button>
    </div>
    <div class="section-divider">
      <label class="checkbox-label">
        <input type="checkbox" id="config_disable_resume">
        <span>禁用断点续传（每次重新下载）</span>
      </label>
      <div class="cache-buttons-grid">
        <button class="cache-clear-btn" data-type="progress">📥 下载进度</button>
        <button class="cache-clear-btn" data-type="config">⚙️ 配置设置</button>
        <button class="cache-clear-btn" data-type="rules">📋 清洗规则</button>
        <button class="cache-clear-btn" data-type="sites">🌐 站点规则</button>
      </div>
      <button id="clearAllCacheButton">🗑️ 清除所有缓存数据</button>
    </div>
    <button id="saveConfigButton">保存设置</button>
  </div>
</div>
<div id="ruleModal" style="display:none;">
  <h3>站点规则管理<span id="ruleModalClose" style="cursor: pointer; float: right; margin:-8px -4px;">✕</span></h3>
  <div class="modal-body" style="max-height: 60vh; overflow-y: auto;">
    <div class="button-group">
      <button id="addRuleButton">➕ 添加规则</button>
      <button id="exportRulesButton">📤 导出</button>
      <button id="importRulesButton">📥 导入</button>
    </div>
    <div id="rulesList"></div>
  </div>
</div>
<div id="previewModal" style="display:none;">
  <h3>章节预览<span id="previewModalClose" style="cursor: pointer; float: right; margin:-8px -4px;">✕</span></h3>
  <div class="modal-body">
    <div id="previewContent" style="max-height: 50vh; overflow-y: auto; white-space: pre-wrap; line-height: 1.8; font-size: 14px;"></div>
    <div id="previewProgress" style="margin-top: 10px; color: #666;"></div>
  </div>
</div>
<div id="cleanRuleModal" style="display:none;">
  <h3>🧹 内容清洗规则管理<span id="cleanRuleModalClose" style="cursor: pointer; float: right; margin:-8px -4px;">✕</span></h3>
  <div class="modal-body" style="max-height: 60vh; overflow-y: auto;">
    <div class="tip-box">
      <strong>💡 提示：</strong>清洗规则使用正则表达式匹配并删除内容中的垃圾文本。内置规则可禁用，自定义规则可编辑删除。
    </div>
    <div class="button-group button-group-4">
      <button id="addCleanRuleButton">➕ 添加规则</button>
      <button id="importCleanRulesButton">📥 导入</button>
      <button id="exportCleanRulesButton">📤 导出</button>
      <button id="resetCleanRulesButton">🔄 重置</button>
    </div>
    <div id="cleanRulesList"></div>
  </div>
</div>
<div id="ruleAnalyzerModal" style="display:none;">
  <h3 id="analyzerModalTitle">智能规则分析<span id="analyzerModalClose" style="cursor: pointer; float: right; margin:-8px -4px;">✕</span></h3>
  <div class="modal-body">
    <div id="analyzerContent" style="max-height: 50vh; overflow-y: auto; font-size: 13px; color: #666; line-height: 1.8;"></div>
    <div class="button-group">
      <button id="applyRuleButton">✓ 应用规则</button>
      <button id="exportAnalyzedRuleButton">📤 导出规则</button>
      <button id="closeAnalyzerButton" class="button-gray">关闭</button>
    </div>
  </div>
</div>
`;
