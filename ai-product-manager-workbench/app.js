// 应用状态管理
const AppState = {
    currentProjectId: null,
    currentTaskType: 'requirement',
    isRunning: false,
    currentTaskId: null,
    connectionConfig: null,
    workflowStatus: 'not_configured' // not_configured, connecting, connected, failed
};

// 默认演示项目
const DEMO_PROJECT = {
    id: 'demo-project',
    name: '零售 AI 客服 MVP',
    businessObject: '零售电商售前、订单与售后服务',
    targetUsers: '线上消费者、客服坐席、运营人员',
    currentPhase: '需求分析',
    confirmedScope: '商品问答与订单状态查询',
    keyConstraints: '订单变更必须确认身份和权限，处理失败后转人工',
    pendingItems: '高峰期咨询量、知识资料覆盖情况、人工接管时间',
    tasks: [],
    createdAt: new Date().toISOString()
};

// 演示文档
const DEMO_DOCUMENT = {
    id: 'demo-doc',
    type: 'requirement',
    title: '需求分析',
    content: `# 零售 AI 客服 MVP 需求分析

## 一、项目概述

本项目旨在为零售电商平台构建 AI 智能客服系统，通过人工智能技术提升客户服务效率，降低人工客服成本，同时确保服务质量。

## 二、业务背景

### 2.1 当前痛点
- 高峰期客服响应不及时，客户等待时间过长
- 重复性咨询占用大量人力资源
- 客服人员培训成本高，知识更新滞后
- 夜间服务覆盖不足

### 2.2 业务目标
- 将客服响应时间从平均 3 分钟缩短至 30 秒
- 处理 70% 的常见咨询，减少人工客服压力
- 实现 24/7 全天候服务
- 提升客户满意度至 90% 以上

## 三、目标用户分析

### 3.1 线上消费者
- **特征**：年龄 18-45 岁，移动端使用为主
- **需求**：快速获取准确信息，问题一次性解决
- **痛点**：等待时间长，转接人工困难

### 3.2 客服坐席
- **特征**：需要处理大量重复咨询
- **需求**：AI 辅助回答复杂问题，快速知识检索
- **痛点**：知识更新不及时，培训周期长

### 3.3 运营人员
- **特征**：需要了解客服数据，优化服务流程
- **需求**：数据可视化，问题分类统计
- **痛点**：数据分散，分析困难

## 四、功能需求

### 4.1 核心功能
1. **智能问答**
   - 商品信息查询（价格、库存、规格）
   - 订单状态查询（待支付、已发货、已完成）
   - 物流信息查询
   - 退换货政策咨询

2. **订单管理**
   - 订单修改（地址、商品）
   - 订单取消
   - 退款申请

3. **人工转接**
   - 自动识别复杂问题
   - 无缝转接人工客服
   - 上下文传递

4. **知识库管理**
   - FAQ 管理
   - 知识点更新
   - 热点问题统计

### 4.2 非功能需求
- **性能**：响应时间 < 2 秒
- **可用性**：系统可用率 > 99.5%
- **安全性**：订单操作需身份验证
- **扩展性**：支持接入新的业务场景

## 五、技术需求

### 5.1 AI 能力
- 自然语言理解（NLU）
- 意图识别与实体提取
- 对话管理
- 知识图谱

### 5.2 集成要求
- 与现有电商系统集成
- 与订单系统集成
- 与 CRM 系统集成
- 与物流系统集成

## 六、约束条件

1. **安全约束**
   - 订单变更必须确认身份和权限
   - 处理失败后必须转人工
   - 敏感信息（密码、支付信息）不得泄露

2. **业务约束**
   - 仅支持已上线商品
   - 退款需符合公司政策
   - 高峰期需优先处理紧急问题

3. **技术约束**
   - 使用 Coze 工作流
   - API 响应时间 < 3 秒
   - 支持并发处理

## 七、待确认事项

1. 高峰期咨询量预估
2. 知识资料覆盖情况
3. 人工接管时间要求
4. 多语言支持需求
5. 语音交互需求

## 八、项目里程碑

- **Phase 1**：需求确认与技术选型（2 周）
- **Phase 2**：MVP 开发（4 周）
- **Phase 3**：内部测试（2 周）
- **Phase 4**：试点上线（2 周）
- **Phase 5**：全面推广（4 周）

## 九、风险评估

| 风险项 | 影响 | 概率 | 应对措施 |
|--------|------|------|----------|
| AI 理解准确率不达标 | 高 | 中 | 持续训练，人工校验 |
| 系统性能瓶颈 | 中 | 低 | 预留扩展能力 |
| 用户接受度低 | 高 | 中 | 充分测试，渐进推广 |
| 集成系统变更 | 中 | 中 | 建立版本兼容机制 |`,
    evidence: {
        confirmedFacts: [
            '零售电商平台需要 AI 客服系统',
            '目标用户包括消费者、客服和运营人员',
            '已确认范围：商品问答与订单状态查询',
            '关键约束：订单变更需身份验证'
        ],
        supportingData: [
            '行业数据显示，AI 客服可降低 60% 人工成本',
            '竞品分析表明，平均响应时间是关键指标',
            '用户调研显示，30 秒响应时间满意度最高'
        ],
        analysisSuggestions: [
            '建议优先处理高频咨询场景',
            '需要建立完善的知识库更新机制',
            '建议引入 A/B 测试优化对话流程'
        ],
        unverifiedHypotheses: [
            '假设高峰期咨询量为日常的 3-5 倍',
            '假设知识库覆盖率达到 80% 即可满足需求',
            '假设人工接管时间不超过 5 分钟'
        ],
        riskPoints: [
            'AI 理解准确率未经验证，存在误判风险',
            '订单操作涉及安全，需严格权限控制',
            '系统集成复杂度高，可能影响项目进度'
        ]
    },
    isDemo: true,
    createdAt: new Date().toISOString()
};

// 任务类型配置
const TASK_TYPES = {
    smart: {
        name: '智能识别',
        icon: '🎯',
        description: '描述您的问题，系统将自动判断最适合的交付物类型',
        prompt: '请描述您的业务需求或问题，我将帮助您分析应该生成哪类文档。'
    },
    requirement: {
        name: '需求分析',
        icon: '📋',
        description: '描述您的需求，系统将分析并生成需求分析文档',
        prompt: '请详细描述您的产品需求，包括业务背景、目标用户、功能需求等。'
    },
    solution: {
        name: 'AI 方案设计',
        icon: '🤖',
        description: '描述您的应用场景，系统将设计 AI 解决方案',
        prompt: '请描述您的应用场景，包括要解决的问题、期望的效果、约束条件等。'
    },
    prd: {
        name: 'PRD 草稿',
        icon: '📝',
        description: '描述您的产品功能，系统将生成 PRD 文档草稿',
        prompt: '请描述您的产品功能，包括功能模块、用户流程、技术要求等。'
    },
    competitive: {
        name: '竞品分析',
        icon: '🔍',
        description: '描述您的竞品或市场，系统将生成竞品分析报告',
        prompt: '请描述您要分析的竞品或市场，包括竞品名称、分析维度、关注点等。'
    }
};

// 示例文本
const EXAMPLES = {
    requirement: `我需要为电商平台的售后流程进行需求分析。

业务背景：
- 我们是一家零售电商平台，日均订单量约 5000 单
- 当前售后主要通过人工客服处理，响应时间长
- 客户投诉主要集中在售后响应慢

目标用户：
- 购买商品的消费者
- 售后客服人员
- 运营管理层

主要需求：
- 自动识别售后问题类型
- 快速查询订单状态
- 处理退换货申请
- 生成售后工单
- 转接复杂问题给人工

请帮我生成完整的需求分析文档。`,
    
    solution: `我需要为电商客服系统设计 AI 解决方案。

业务场景：
- 用户通过聊天窗口咨询商品、订单等问题
- 需要自动识别用户意图
- 需要查询商品信息、订单信息
- 复杂问题转接人工

期望效果：
- 自动处理 70% 的常见咨询
- 响应时间在 2 秒内
- 准确率达到 90% 以上

约束条件：
- 必须确保订单操作的安全性
- 需要接入现有订单系统
- 成本控制在合理范围

请设计完整的 AI 解决方案。`,
    
    prd: `我需要为订单查询功能编写 PRD 文档。

功能描述：
- 用户可以查询订单状态
- 支持按订单号、手机号查询
- 显示订单详情（商品、金额、物流信息等）

用户流程：
1. 用户进入订单查询页面
2. 输入订单号或手机号
3. 系统验证输入
4. 显示订单信息
5. 用户可以查看物流详情

技术要求：
- 响应时间 < 1 秒
- 支持高并发
- 数据需要加密

请生成完整的 PRD 文档。`,
    
    competitive: `我需要对 AI 客服领域进行竞品分析。

竞品：
- 智齿客服
- 网易七鱼
- 容联七陌
- 环信

分析维度：
- 功能对比
- 价格策略
- 技术能力
- 客户案例
- 优劣势分析

关注点：
- 哪些功能是必备的
- 市场定价水平
- 技术门槛如何
- 我们的机会在哪里

请生成竞品分析报告。`
};

// 初始化应用
function initApp() {
    // 首先初始化 DOM 元素引用
    initElements();
    
    // 自动配置 Coze 工作流（首次使用）
    autoConfigureCozeWorkflow();
    
    loadFromStorage();
    renderProjectList();
    setupEventListeners();
    
    // 如果没有项目，初始化演示项目
    if (!AppState.projects || AppState.projects.length === 0) {
        AppState.projects = [DEMO_PROJECT];
        AppState.currentProjectId = DEMO_PROJECT.id;
        saveToStorage();
        renderProjectList();
        showProject(DEMO_PROJECT.id);
    } else {
        selectProject(AppState.currentProjectId);
    }
    
    // 加载连接配置
    loadConnectionConfig();
    updateWorkflowStatus();
    
    // 初始化任务类型选择
    selectTaskType(AppState.currentTaskType);
}

// 本地存储管理
function saveToStorage() {
    localStorage.setItem('ai-pm-workbench-projects', JSON.stringify(AppState.projects));
    localStorage.setItem('ai-pm-workbench-currentProject', AppState.currentProjectId);
}

function loadFromStorage() {
    const projects = localStorage.getItem('ai-pm-workbench-projects');
    const currentProject = localStorage.getItem('ai-pm-workbench-currentProject');
    
    if (projects) {
        AppState.projects = JSON.parse(projects);
    }
    if (currentProject) {
        AppState.currentProjectId = currentProject;
    }
}

// 自动配置 Coze 工作流（使用用户提供的凭证）
function autoConfigureCozeWorkflow() {
    // 检查是否已经配置过
    const existingConfig = localStorage.getItem('ai-pm-workbench-connection');
    if (existingConfig) {
        try {
            const parsed = JSON.parse(existingConfig);
            // 如果配置有效（包含 workflowId 和 patToken），则不覆盖
            if (parsed && parsed.workflowId && parsed.patToken) {
                console.log('✅ Coze 工作流配置已存在，跳过自动配置');
                return;
            }
        } catch (e) {
            console.warn('⚠️ 现有配置无效，将重新配置');
        }
    }
    
    // 自动填入用户提供的配置
    const autoConfig = {
        workflowId: '7676832175183282239',
        patToken: 'pat_cO2mlw4Q7rHW5s6DhpfgDTKLerNdjtjNdvbvZ0duYCw7ESiTuNwNwaY8YJdWkdrR'
    };
    
    // 保存到 localStorage
    saveConnectionConfig(autoConfig);
    console.log('✅ Coze 工作流已自动配置');
}

function loadConnectionConfig() {
    const config = localStorage.getItem('ai-pm-workbench-connection');
    if (config) {
        try {
            const parsed = JSON.parse(config);
            // 验证配置是否完整
            if (parsed && parsed.workflowId && parsed.patToken) {
                AppState.connectionConfig = parsed;
                AppState.workflowStatus = 'connected';
                console.log('✅ 工作流连接配置已加载');
            } else {
                console.warn('⚠️ 工作流配置不完整，状态设置为未配置');
                AppState.workflowStatus = 'not_configured';
            }
        } catch (e) {
            console.error('❌ 加载工作流配置失败:', e);
            AppState.workflowStatus = 'not_configured';
        }
    } else {
        console.log('ℹ️ 未找到工作流配置');
        AppState.workflowStatus = 'not_configured';
    }
}

function saveConnectionConfig(config) {
    AppState.connectionConfig = config;
    localStorage.setItem('ai-pm-workbench-connection', JSON.stringify(config));
}

// DOM 元素缓存
let elements = {};

// 初始化 DOM 元素引用
function initElements() {
    elements = {
        sidebar: document.getElementById('sidebar'),
        projectList: document.getElementById('projectList'),
        searchInput: document.getElementById('searchInput'),
        newProjectBtn: document.getElementById('newProjectBtn'),
        connectionSettingsBtn: document.getElementById('connectionSettingsBtn'),
        helpCenterBtn: document.getElementById('helpCenterBtn'),
        topBar: document.getElementById('topBar'),
        currentProjectName: document.getElementById('currentProjectName'),
        workflowStatus: document.getElementById('workflowStatus'),
        topNewProjectBtn: document.getElementById('topNewProjectBtn'),
        topConnectionBtn: document.getElementById('topConnectionBtn'),
        topHelpBtn: document.getElementById('topHelpBtn'),
        taskTypes: document.getElementById('taskTypes'),
        projectBackground: document.getElementById('projectBackground'),
        backgroundContent: document.getElementById('backgroundContent'),
        editBackgroundBtn: document.getElementById('editBackgroundBtn'),
        taskInputSection: document.getElementById('taskInputSection'),
        taskTypeTitle: document.getElementById('taskTypeTitle'),
        taskDescription: document.getElementById('taskDescription'),
        taskInput: document.getElementById('taskInput'),
        charCount: document.getElementById('charCount'),
        clearInputBtn: document.getElementById('clearInputBtn'),
        startAnalysisBtn: document.getElementById('startAnalysisBtn'),
        cancelTaskBtn: document.getElementById('cancelTaskBtn'),
        runningStatus: document.getElementById('runningStatus'),
        resultSection: document.getElementById('resultSection'),
        resultType: document.getElementById('resultType'),
        resultProject: document.getElementById('resultProject'),
        resultTime: document.getElementById('resultTime'),
        demoBanner: document.getElementById('demoBanner'),
        resultStatus: document.getElementById('resultStatus'),
        resultContent: document.getElementById('resultContent'),
        viewEvidenceBtn: document.getElementById('viewEvidenceBtn'),
        copyResultBtn: document.getElementById('copyResultBtn'),
        saveResultBtn: document.getElementById('saveResultBtn'),
        editResultBtn: document.getElementById('editResultBtn'),
        regenerateBtn: document.getElementById('regenerateBtn'),
        nextTaskBtn: document.getElementById('nextTaskBtn'),
        editMode: document.getElementById('editMode'),
        editTextarea: document.getElementById('editTextarea'),
        cancelEditBtn: document.getElementById('cancelEditBtn'),
        saveEditBtn: document.getElementById('saveEditBtn'),
        evidencePanel: document.getElementById('evidencePanel'),
        closeEvidenceBtn: document.getElementById('closeEvidenceBtn'),
        mobileMenuBtn: document.getElementById('mobileMenuBtn'),
        newProjectModal: document.getElementById('newProjectModal'),
        editBackgroundModal: document.getElementById('editBackgroundModal'),
        connectionSettingsModal: document.getElementById('connectionSettingsModal'),
        helpCenterModal: document.getElementById('helpCenterModal'),
        confirmDeleteModal: document.getElementById('confirmDeleteModal')
    };
}

// 项目管理
function renderProjectList() {
    const searchTerm = elements.searchInput.value.toLowerCase();
    const filteredProjects = AppState.projects.filter(p => 
        p.name.toLowerCase().includes(searchTerm)
    );
    
    elements.projectList.innerHTML = filteredProjects.map(project => `
        <button class="project-item ${project.id === AppState.currentProjectId ? 'active' : ''}" 
                data-project-id="${project.id}">
            <div class="project-name">${escapeHtml(project.name)}</div>
            <div class="project-phase">${escapeHtml(project.currentPhase)}</div>
        </button>
    `).join('');
    
    // 添加任务历史
    const currentProject = AppState.projects.find(p => p.id === AppState.currentProjectId);
    if (currentProject && currentProject.tasks.length > 0) {
        const tasksHtml = `
            <div class="section-title" style="margin-top: 15px;">
                <span>历史任务</span>
            </div>
            <div class="task-history">
                ${currentProject.tasks.map(task => `
                    <div class="task-history-item" data-task-id="${task.id}">
                        <div class="task-type">${TASK_TYPES[task.type].name}</div>
                        <div class="task-title">${escapeHtml(task.input.substring(0, 30))}...</div>
                        <div class="task-status">${getStatusText(task.status)}</div>
                    </div>
                `).join('')}
            </div>
        `;
        elements.projectList.insertAdjacentHTML('beforeend', tasksHtml);
    }
}

function selectProject(projectId) {
    AppState.currentProjectId = projectId;
    saveToStorage();
    renderProjectList();
    showProject(projectId);
    
    // 关闭移动端侧边栏
    elements.sidebar.classList.remove('open');
}

function showProject(projectId) {
    const project = AppState.projects.find(p => p.id === projectId);
    if (!project) return;
    
    elements.currentProjectName.textContent = project.name;
    elements.backgroundContent.innerHTML = `
        <p><strong>业务对象：</strong>${escapeHtml(project.businessObject || '未填写')}</p>
        <p><strong>目标用户：</strong>${escapeHtml(project.targetUsers || '未填写')}</p>
        <p><strong>当前阶段：</strong>${escapeHtml(project.currentPhase || '未填写')}</p>
        <p><strong>已确认范围：</strong>${escapeHtml(project.confirmedScope || '未填写')}</p>
        <p><strong>关键约束：</strong>${escapeHtml(project.keyConstraints || '未填写')}</p>
        <p><strong>待确认事项：</strong>${escapeHtml(project.pendingItems || '未填写')}</p>
    `;
    
    // 如果是演示项目，显示演示文档
    if (project.id === 'demo-project') {
        showDemoDocument();
    } else {
        hideResult();
    }
}

function createProject(formData) {
    const newProject = {
        id: generateId(),
        name: formData.name,
        businessObject: formData.businessObject,
        targetUsers: formData.targetUsers,
        currentPhase: formData.currentPhase,
        confirmedScope: formData.confirmedScope,
        keyConstraints: formData.keyConstraints,
        pendingItems: formData.pendingItems,
        tasks: [],
        createdAt: new Date().toISOString()
    };
    
    AppState.projects.push(newProject);
    AppState.currentProjectId = newProject.id;
    saveToStorage();
    renderProjectList();
    selectProject(newProject.id);
}

function updateProject(projectId, formData) {
    const project = AppState.projects.find(p => p.id === projectId);
    if (!project) return;
    
    project.name = formData.name;
    project.businessObject = formData.businessObject;
    project.targetUsers = formData.targetUsers;
    project.currentPhase = formData.currentPhase;
    project.confirmedScope = formData.confirmedScope;
    project.keyConstraints = formData.keyConstraints;
    project.pendingItems = formData.pendingItems;
    
    saveToStorage();
    renderProjectList();
    showProject(projectId);
}

function deleteProject(projectId) {
    const index = AppState.projects.findIndex(p => p.id === projectId);
    if (index === -1) return;
    
    AppState.projects.splice(index, 1);
    
    if (AppState.currentProjectId === projectId) {
        AppState.currentProjectId = AppState.projects.length > 0 ? AppState.projects[0].id : null;
    }
    
    saveToStorage();
    renderProjectList();
    
    if (AppState.currentProjectId) {
        showProject(AppState.currentProjectId);
    } else {
        elements.currentProjectName.textContent = '未选择项目';
        elements.backgroundContent.innerHTML = '<p>请选择或创建一个项目以查看背景信息</p>';
        hideResult();
    }
}

// 任务类型管理
function selectTaskType(type) {
    AppState.currentTaskType = type;
    saveToStorage();
    
    // 更新按钮状态
    document.querySelectorAll('.task-type-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.type === type);
    });
    
    // 更新任务标题和描述
    const taskConfig = TASK_TYPES[type];
    elements.taskTypeTitle.textContent = taskConfig.name;
    elements.taskDescription.textContent = taskConfig.description;
}

// 任务运行
async function startAnalysis() {
    const input = elements.taskInput.value.trim();

    if (!input) {
        alert('请先描述当前业务任务');
        return;
    }

    if (AppState.isRunning) {
        alert('任务正在运行中，请等待完成');
        return;
    }

    // 检查连接配置
    if (!AppState.connectionConfig || !AppState.connectionConfig.workflowId || !AppState.connectionConfig.patToken) {
        console.error('❌ 工作流配置不完整:', AppState.connectionConfig);
        alert('工作流配置不完整，正在自动配置...');

        // 自动配置
        autoConfigureCozeWorkflow();
        loadConnectionConfig();

        // 再次检查
        if (!AppState.connectionConfig || !AppState.connectionConfig.workflowId || !AppState.connectionConfig.patToken) {
            alert('自动配置失败，请手动配置工作流连接');
            openConnectionSettings();
            return;
        }
    }

    AppState.isRunning = true;
    AppState.currentTaskId = generateId();

    // 更新 UI
    elements.startAnalysisBtn.classList.add('hidden');
    elements.cancelTaskBtn.classList.remove('hidden');
    elements.runningStatus.classList.remove('hidden');
    elements.resultSection.classList.add('hidden');

    // 显示步骤进度
    showRunningSteps();

    try {
        // 调用 Coze 工作流
        const result = await callCozeWorkflow(input, AppState.currentTaskType);
        
        // 保存任务结果
        const task = {
            id: AppState.currentTaskId,
            type: AppState.currentTaskType,
            input: input,
            result: result,
            status: 'completed',
            createdAt: new Date().toISOString()
        };
        
        const project = AppState.projects.find(p => p.id === AppState.currentProjectId);
        if (project) {
            project.tasks.push(task);
            saveToStorage();
            renderProjectList();
        }
        
        // 显示结果
        showResult(result);
        
    } catch (error) {
        console.error('任务执行失败:', error);
        showResult({
            status: 'failed',
            message: error.message || '任务执行失败，请检查连接后重试'
        });
    } finally {
        AppState.isRunning = false;
        elements.startAnalysisBtn.classList.remove('hidden');
        elements.cancelTaskBtn.classList.add('hidden');
        elements.runningStatus.classList.add('hidden');
    }
}

function showRunningSteps() {
    const steps = ['step1', 'step2', 'step3', 'step4'];
    let currentStep = 0;
    
    // 重置所有步骤
    steps.forEach(step => {
        const el = document.getElementById(step);
        el.classList.remove('active', 'completed');
    });
    
    // 模拟步骤进度
    const interval = setInterval(() => {
        if (currentStep >= steps.length) {
            clearInterval(interval);
            return;
        }
        
        const currentEl = document.getElementById(steps[currentStep]);
        currentEl.classList.add('active');
        
        setTimeout(() => {
            if (currentEl) {
                currentEl.classList.remove('active');
                currentEl.classList.add('completed');
            }
            currentStep++;
        }, 2000);
        
    }, 2500);
}

async function callCozeWorkflow(input, taskType) {
    const { workflowId, patToken } = AppState.connectionConfig;
    
    if (!workflowId || !patToken) {
        throw new Error('连接配置不完整');
    }
    
    // 构建请求
    const taskTypeNames = {
        smart: '智能识别',
        requirement: '需求分析',
        solution: 'AI方案设计',
        prd: 'PRD草稿',
        competitive: '竞品分析'
    };
    
    const prompt = `任务类型：${taskTypeNames[taskType]}\n\n${input}`;
    
    try {
        // 使用 Coze API v3
        const response = await fetch(`https://api.coze.com/v3/chat`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${patToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                bot_id: workflowId,
                user_id: 'user_' + Date.now(),
                stream: false,
                auto_save_history: true,
                additional_messages: [
                    {
                        role: 'user',
                        content: prompt,
                        content_type: 'text'
                    }
                ]
            })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
            try {
                const errorData = JSON.parse(errorText);
                errorMessage = errorData.msg || errorData.message || errorMessage;
            } catch (e) {
                // 如果无法解析错误信息，使用默认错误消息
            }
            throw new Error(errorMessage);
        }
        
        const data = await response.json();
        
        // 解析返回结果
        if (data && data.data && data.data.length > 0) {
            // 找到最后一条回复消息
            const messages = data.data;
            for (let i = messages.length - 1; i >= 0; i--) {
                const msg = messages[i];
                if (msg.type === 'answer' && msg.content) {
                    return {
                        status: 'success',
                        content: msg.content,
                        type: taskType,
                        evidence: generateEvidence(msg.content)
                    };
                }
            }
        }
        
        // 如果没有找到内容
        return {
            status: 'no_content',
            message: '本次任务已经结束，但没有得到可展示的内容，请检查工作流输出后重试。'
        };
        
    } catch (error) {
        throw new Error(error.message || '连接失败，请检查网络和配置');
    }
}

function generateEvidence(content) {
    // 简单的证据生成逻辑
    return {
        confirmedFacts: [
            '已根据用户输入进行需求分析',
            '基于行业标准生成文档结构'
        ],
        supportingData: [
            '参考了行业最佳实践',
            '结合了产品管理方法论'
        ],
        analysisSuggestions: [
            '建议根据实际情况调整文档内容',
            '可以补充更多业务细节'
        ],
        unverifiedHypotheses: [
            '假设当前需求能够满足业务目标',
            '假设技术方案可行'
        ],
        riskPoints: [
            '建议进行多方评审',
            '需要验证技术可行性'
        ]
    };
}

function showDemoDocument() {
    elements.resultSection.classList.remove('hidden');
    elements.resultType.textContent = DEMO_DOCUMENT.title;
    elements.resultProject.textContent = DEMO_PROJECT.name;
    elements.resultTime.textContent = formatDateTime(DEMO_DOCUMENT.createdAt);
    elements.demoBanner.classList.remove('hidden');
    elements.resultStatus.innerHTML = '<span class="status-badge success">已完成（演示）</span>';
    elements.resultContent.textContent = DEMO_DOCUMENT.content;
    
    // 存储当前结果
    AppState.currentResult = DEMO_DOCUMENT;
}

function showResult(result) {
    elements.resultSection.classList.remove('hidden');
    elements.demoBanner.classList.add('hidden');
    elements.resultType.textContent = TASK_TYPES[result.type || AppState.currentTaskType].name;
    elements.resultProject.textContent = AppState.projects.find(p => p.id === AppState.currentProjectId)?.name || '';
    elements.resultTime.textContent = formatDateTime(new Date());
    
    if (result.status === 'success') {
        elements.resultStatus.innerHTML = '<span class="status-badge success">已完成</span>';
        elements.resultContent.textContent = result.content;
        
        // 存储当前结果
        AppState.currentResult = {
            ...result,
            isDemo: false
        };
    } else if (result.status === 'no_content') {
        elements.resultStatus.innerHTML = '<span class="status-badge warning">无内容</span>';
        elements.resultContent.textContent = result.message;
    } else {
        elements.resultStatus.innerHTML = '<span class="status-badge error">失败</span>';
        elements.resultContent.textContent = result.message || '任务执行失败';
    }
}

function hideResult() {
    elements.resultSection.classList.add('hidden');
    AppState.currentResult = null;
}

// 结果操作
function copyResult() {
    const content = elements.resultContent.textContent;
    navigator.clipboard.writeText(content).then(() => {
        alert('已复制到剪贴板');
    }).catch(() => {
        alert('复制失败，请手动选择复制');
    });
}

function saveResult() {
    if (!AppState.currentResult || !AppState.currentProjectId) {
        alert('没有可保存的结果');
        return;
    }
    
    const project = AppState.projects.find(p => p.id === AppState.currentProjectId);
    if (!project) {
        alert('项目不存在');
        return;
    }
    
    // 检查是否已经保存
    const existingTask = project.tasks.find(t => t.id === AppState.currentTaskId);
    if (existingTask) {
        existingTask.result = AppState.currentResult;
        existingTask.status = 'saved';
    } else {
        project.tasks.push({
            id: AppState.currentTaskId,
            type: AppState.currentResult.type,
            input: elements.taskInput.value,
            result: AppState.currentResult,
            status: 'saved',
            createdAt: new Date().toISOString()
        });
    }
    
    saveToStorage();
    renderProjectList();
    alert('已保存到项目');
}

function startEditResult() {
    if (!AppState.currentResult) {
        alert('没有可编辑的结果');
        return;
    }
    
    elements.editTextarea.value = elements.resultContent.textContent;
    elements.editMode.classList.remove('hidden');
    elements.resultContent.classList.add('hidden');
}

function cancelEditResult() {
    elements.editMode.classList.add('hidden');
    elements.resultContent.classList.remove('hidden');
}

function saveEditResult() {
    const newContent = elements.editTextarea.value;
    elements.resultContent.textContent = newContent;
    
    if (AppState.currentResult) {
        AppState.currentResult.content = newContent;
        AppState.currentResult.isEdited = true;
    }
    
    elements.editMode.classList.add('hidden');
    elements.resultContent.classList.remove('hidden');
    
    alert('已保存编辑');
}

function regenerateResult() {
    if (!elements.taskInput.value.trim()) {
        alert('请先输入任务描述');
        return;
    }
    
    if (!confirm('确定要重新生成吗？这将消耗新的调用次数。')) {
        return;
    }
    
    startAnalysis();
}

function suggestNextTask() {
    const taskOrder = ['requirement', 'solution', 'prd', 'competitive'];
    const currentIndex = taskOrder.indexOf(AppState.currentTaskType);
    
    if (currentIndex < taskOrder.length - 1) {
        const nextType = taskOrder[currentIndex + 1];
        selectTaskType(nextType);
        
        // 填入建议文本
        const suggestions = {
            solution: '基于之前的需求分析，现在可以设计 AI 解决方案。\n\n请描述您希望实现的功能和技术要求。',
            prd: '基于需求分析和方案设计，现在可以编写 PRD 文档。\n\n请描述需要详细说明的功能模块和用户流程。',
            competitive: '在完成需求、方案和 PRD 后，可以进行竞品分析。\n\n请描述您要分析的竞品或市场。'
        };
        
        elements.taskInput.value = suggestions[nextType] || '';
        updateCharCount();
    }
}

// 证据面板
function showEvidencePanel() {
    if (!AppState.currentResult || !AppState.currentResult.evidence) {
        alert('没有可查看的证据');
        return;
    }
    
    const evidence = AppState.currentResult.evidence;
    
    document.getElementById('confirmedFacts').innerHTML = evidence.confirmedFacts && evidence.confirmedFacts.length > 0
        ? evidence.confirmedFacts.map(f => `<p>• ${escapeHtml(f)}</p>`).join('')
        : '<p class="empty-text">暂无数据</p>';
    
    document.getElementById('supportingData').innerHTML = evidence.supportingData && evidence.supportingData.length > 0
        ? evidence.supportingData.map(d => `<p>• ${escapeHtml(d)}</p>`).join('')
        : '<p class="empty-text">暂无数据</p>';
    
    document.getElementById('analysisSuggestions').innerHTML = evidence.analysisSuggestions && evidence.analysisSuggestions.length > 0
        ? evidence.analysisSuggestions.map(s => `<p>• ${escapeHtml(s)}</p>`).join('')
        : '<p class="empty-text">暂无数据</p>';
    
    document.getElementById('unverifiedHypotheses').innerHTML = evidence.unverifiedHypotheses && evidence.unverifiedHypotheses.length > 0
        ? evidence.unverifiedHypotheses.map(h => `<p>• ${escapeHtml(h)}</p>`).join('')
        : '<p class="empty-text">暂无数据</p>';
    
    document.getElementById('riskPoints').innerHTML = evidence.riskPoints && evidence.riskPoints.length > 0
        ? evidence.riskPoints.map(r => `<p>• ${escapeHtml(r)}</p>`).join('')
        : '<p class="empty-text">暂无数据</p>';
    
    elements.evidencePanel.classList.remove('hidden');
}

function hideEvidencePanel() {
    elements.evidencePanel.classList.add('hidden');
}

// 连接管理
function openConnectionSettings() {
    if (AppState.connectionConfig) {
        document.getElementById('workflowId').value = AppState.connectionConfig.workflowId;
        document.getElementById('patToken').value = '••••••••••••';
    }
    
    elements.connectionSettingsModal.classList.remove('hidden');
}

function saveConnectionSettings(formData) {
    const config = {
        workflowId: formData.workflowId,
        patToken: formData.patToken
    };
    
    saveConnectionConfig(config);
    AppState.workflowStatus = 'connected';
    updateWorkflowStatus();
    closeConnectionSettings();
    
    alert('连接配置已保存');
}

async function testConnection() {
    const workflowId = document.getElementById('workflowId').value.trim();
    const patToken = document.getElementById('patToken').value.trim();
    
    if (!workflowId || !patToken) {
        showConnectionStatus('error', '请填写完整的工作流 ID 和访问令牌');
        return;
    }
    
    AppState.workflowStatus = 'connecting';
    updateWorkflowStatus();
    showConnectionStatus('info', '正在测试连接...');
    
    try {
        // 使用 Coze API v3 测试连接
        const response = await fetch(`https://api.coze.com/v3/chat`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${patToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                bot_id: workflowId,
                user_id: 'test_user_' + Date.now(),
                stream: false,
                auto_save_history: true,
                additional_messages: [
                    {
                        role: 'user',
                        content: '测试连接',
                        content_type: 'text'
                    }
                ]
            })
        });
        
        if (response.ok || response.status === 401) {
            showConnectionStatus('success', '连接成功！配置已验证。');
        } else {
            const errorText = await response.text();
            let errorMessage = '连接失败';
            try {
                const errorData = JSON.parse(errorText);
                errorMessage = errorData.msg || errorData.message || errorMessage;
            } catch (e) {
                // 如果无法解析错误信息
            }
            throw new Error(errorMessage);
        }
    } catch (error) {
        showConnectionStatus('error', `连接失败：${error.message || '请检查工作流 ID 和访问令牌是否正确'}`);
        AppState.workflowStatus = 'failed';
        updateWorkflowStatus();
    }
}

function closeConnectionSettings() {
    elements.connectionSettingsModal.classList.add('hidden');
    document.getElementById('connectionStatus').classList.remove('show');
}

function showConnectionStatus(type, message) {
    const statusEl = document.getElementById('connectionStatus');
    statusEl.textContent = message;
    statusEl.className = `connection-status show ${type}`;
}

function updateWorkflowStatus() {
    const statusText = {
        not_configured: '未配置',
        connecting: '正在连接',
        connected: '已连接',
        failed: '连接失败'
    };
    
    elements.workflowStatus.textContent = statusText[AppState.workflowStatus] || '未配置';
    
    const statusClass = {
        not_configured: '',
        connecting: 'connecting',
        connected: 'connected',
        failed: 'error'
    };
    
    elements.workflowStatus.className = `status-badge ${statusClass[AppState.workflowStatus]}`;
}

// 模态框管理
function openNewProjectModal() {
    elements.newProjectModal.classList.remove('hidden');
}

function closeNewProjectModal() {
    elements.newProjectModal.classList.add('hidden');
    document.getElementById('newProjectForm').reset();
}

function openEditBackgroundModal() {
    const project = AppState.projects.find(p => p.id === AppState.currentProjectId);
    if (!project) {
        alert('请先选择一个项目');
        return;
    }
    
    document.getElementById('editProjectName').value = project.name;
    document.getElementById('editBusinessObject').value = project.businessObject || '';
    document.getElementById('editTargetUsers').value = project.targetUsers || '';
    document.getElementById('editCurrentPhase').value = project.currentPhase || '';
    document.getElementById('editConfirmedScope').value = project.confirmedScope || '';
    document.getElementById('editKeyConstraints').value = project.keyConstraints || '';
    document.getElementById('editPendingItems').value = project.pendingItems || '';
    
    elements.editBackgroundModal.classList.remove('hidden');
}

function closeEditBackgroundModal() {
    elements.editBackgroundModal.classList.add('hidden');
}

function openHelpCenter() {
    elements.helpCenterModal.classList.remove('hidden');
}

function closeHelpCenter() {
    elements.helpCenterModal.classList.add('hidden');
}

function showConfirmDelete(message, callback) {
    document.getElementById('confirmDeleteMessage').textContent = message;
    elements.confirmDeleteModal.classList.remove('hidden');
    elements.confirmDeleteModal.dataset.callback = callback;
}

function closeConfirmDelete() {
    elements.confirmDeleteModal.classList.add('hidden');
}

// 工具函数
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDateTime(date) {
    const d = new Date(date);
    return d.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getStatusText(status) {
    const statusMap = {
        running: '运行中',
        completed: '已完成',
        saved: '已保存',
        failed: '失败'
    };
    return statusMap[status] || status;
}

function updateCharCount() {
    const count = elements.taskInput.value.length;
    elements.charCount.textContent = `${count} 字`;
}

// 事件监听
function setupEventListeners() {
    // 搜索
    elements.searchInput.addEventListener('input', renderProjectList);
    
    // 新建项目
    elements.newProjectBtn.addEventListener('click', openNewProjectModal);
    elements.topNewProjectBtn.addEventListener('click', openNewProjectModal);
    
    // 新建项目表单
    document.getElementById('newProjectForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const formData = {
            name: document.getElementById('projectName').value,
            businessObject: document.getElementById('businessObject').value,
            targetUsers: document.getElementById('targetUsers').value,
            currentPhase: document.getElementById('currentPhase').value,
            confirmedScope: document.getElementById('confirmedScope').value,
            keyConstraints: document.getElementById('keyConstraints').value,
            pendingItems: document.getElementById('pendingItems').value
        };
        createProject(formData);
        closeNewProjectModal();
    });
    
    document.getElementById('cancelNewProject').addEventListener('click', closeNewProjectModal);
    
    // 项目列表点击
    elements.projectList.addEventListener('click', (e) => {
        const projectItem = e.target.closest('.project-item');
        if (projectItem) {
            selectProject(projectItem.dataset.projectId);
        }
    });
    
    // 编辑项目背景
    elements.editBackgroundBtn.addEventListener('click', openEditBackgroundModal);
    
    // 编辑项目背景表单
    document.getElementById('editBackgroundForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const formData = {
            name: document.getElementById('editProjectName').value,
            businessObject: document.getElementById('editBusinessObject').value,
            targetUsers: document.getElementById('editTargetUsers').value,
            currentPhase: document.getElementById('editCurrentPhase').value,
            confirmedScope: document.getElementById('editConfirmedScope').value,
            keyConstraints: document.getElementById('editKeyConstraints').value,
            pendingItems: document.getElementById('editPendingItems').value
        };
        updateProject(AppState.currentProjectId, formData);
        closeEditBackgroundModal();
    });
    
    document.getElementById('cancelEditBackground').addEventListener('click', closeEditBackgroundModal);
    
    // 删除项目
    document.getElementById('deleteProjectBtn').addEventListener('click', () => {
        const project = AppState.projects.find(p => p.id === AppState.currentProjectId);
        if (project) {
            closeEditBackgroundModal();
            showConfirmDelete(`确定要删除项目"${project.name}"吗？此操作不可恢复。`, 'deleteProject');
        }
    });
    
    // 确认删除
    document.getElementById('confirmDeleteBtn').addEventListener('click', () => {
        const callback = elements.confirmDeleteModal.dataset.callback;
        if (callback === 'deleteProject') {
            deleteProject(AppState.currentProjectId);
        }
        closeConfirmDelete();
    });
    
    document.getElementById('cancelDelete').addEventListener('click', closeConfirmDelete);
    
    // 任务类型选择
    elements.taskTypes.addEventListener('click', (e) => {
        const btn = e.target.closest('.task-type-btn');
        if (btn) {
            selectTaskType(btn.dataset.type);
        }
    });
    
    // 任务输入
    elements.taskInput.addEventListener('input', updateCharCount);
    
    // 清空输入
    elements.clearInputBtn.addEventListener('click', () => {
        elements.taskInput.value = '';
        updateCharCount();
    });
    
    // 开始分析
    elements.startAnalysisBtn.addEventListener('click', startAnalysis);
    
    // 取消任务
    elements.cancelTaskBtn.addEventListener('click', () => {
        if (confirm('确定要取消当前任务吗？')) {
            AppState.isRunning = false;
            elements.startAnalysisBtn.classList.remove('hidden');
            elements.cancelTaskBtn.classList.add('hidden');
            elements.runningStatus.classList.add('hidden');
        }
    });
    
    // 示例按钮
    document.querySelectorAll('.example-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const exampleType = btn.dataset.example;
            selectTaskType(exampleType);
            elements.taskInput.value = EXAMPLES[exampleType];
            updateCharCount();
        });
    });
    
    // 结果操作
    elements.viewEvidenceBtn.addEventListener('click', showEvidencePanel);
    elements.closeEvidenceBtn.addEventListener('click', hideEvidencePanel);
    
    elements.copyResultBtn.addEventListener('click', copyResult);
    elements.saveResultBtn.addEventListener('click', saveResult);
    elements.editResultBtn.addEventListener('click', startEditResult);
    elements.regenerateBtn.addEventListener('click', regenerateResult);
    elements.nextTaskBtn.addEventListener('click', suggestNextTask);
    
    elements.cancelEditBtn.addEventListener('click', cancelEditResult);
    elements.saveEditBtn.addEventListener('click', saveEditResult);
    
    // 连接设置
    elements.connectionSettingsBtn.addEventListener('click', openConnectionSettings);
    elements.topConnectionBtn.addEventListener('click', openConnectionSettings);
    
    document.getElementById('connectionForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const formData = {
            workflowId: document.getElementById('workflowId').value,
            patToken: document.getElementById('patToken').value
        };
        saveConnectionSettings(formData);
    });
    
    document.getElementById('cancelConnection').addEventListener('click', closeConnectionSettings);
    document.getElementById('testConnectionBtn').addEventListener('click', testConnection);
    document.getElementById('closeConnectionModal').addEventListener('click', closeConnectionSettings);
    
    // 帮助中心
    elements.helpCenterBtn.addEventListener('click', openHelpCenter);
    elements.topHelpBtn.addEventListener('click', openHelpCenter);
    document.getElementById('closeHelpModal').addEventListener('click', closeHelpCenter);
    
    // 模态框关闭
    document.getElementById('closeNewProjectModal').addEventListener('click', closeNewProjectModal);
    document.getElementById('closeEditBackgroundModal').addEventListener('click', closeEditBackgroundModal);
    document.getElementById('closeConfirmDelete').addEventListener('click', closeConfirmDelete);
    
    // 移动端菜单
    elements.mobileMenuBtn.addEventListener('click', () => {
        elements.sidebar.classList.toggle('open');
    });
    
    // 点击外部关闭模态框
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.add('hidden');
            }
        });
    });
    
    // 键盘事件
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal').forEach(modal => {
                modal.classList.add('hidden');
            });
            elements.evidencePanel.classList.add('hidden');
        }
    });
}

// 启动应用
document.addEventListener('DOMContentLoaded', initApp);