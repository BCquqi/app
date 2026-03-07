(function() {
    const SUPABASE_URL = 'https://efrcqpwusyrcyoaksnzm.supabase.co';
    const SUPABASE_ANON_KEY = 'sb_publishable_Oj-ZUw0Mb9wQNM9i6fmmuA_HEtg4Ws9';

    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    let currentUser = null;
    let userTeams = [];           // 当前用户已加入的团队
    let allTeams = [];            // 所有团队（用于下拉选择）
    let tickets = [];             // 所属团队的工单（用于团队工单页）
    let myTickets = [];           // 当前用户创建的工单（用于我的工单页）
    let activeTab = 'tickets';
    let authView = 'login';
    let easyMDEditor = null;
    let selectedTeamId = null;
    let selectedTicketId = null;
    let modalState = null;
    let closedTicketsExpanded = {};

    const appEl = document.getElementById('app-content');

    // ---------- 辅助函数 ----------
    function destroyMarkdownEditor() {
        if (easyMDEditor) {
            try { easyMDEditor.toTextArea(); } catch (e) {}
            easyMDEditor = null;
        }
    }

    function initMarkdownEditor(selector = 'ticket-content-md') {
        const textarea = document.getElementById(selector);
        if (!textarea || easyMDEditor) return;
        easyMDEditor = new EasyMDE({
            element: textarea,
            spellChecker: false,
            toolbar: ['bold', 'italic', 'heading', '|', 'quote', 'unordered-list', 'ordered-list', '|', 'link', 'image', '|', 'preview', 'side-by-side', 'fullscreen'],
            status: false,
            minHeight: '200px',
            placeholder: '用 Markdown 描述工单内容...',
        });
    }

    // 获取所有团队及其成员计数、创建者用户名
    async function fetchAllTeams() {
        try {
            const { data: teams, error } = await supabase
                .from('teams')
                .select('*')
                .order('created_at', { ascending: false });
            if (error) throw error;

            const enhanced = await Promise.all((teams || []).map(async (team) => {
                let creatorName = '未知';
                if (team.created_by) {
                    const { data: profile } = await supabase
                        .from('profiles')
                        .select('username')
                        .eq('user_id', team.created_by)
                        .maybeSingle();
                    creatorName = profile?.username || '未知';
                }
                const { count } = await supabase
                    .from('team_members')
                    .select('*', { count: 'exact', head: true })
                    .eq('team_id', team.id);
                return {
                    ...team,
                    creator_name: creatorName,
                    member_count: count || 0
                };
            }));
            return enhanced;
        } catch (err) {
            console.error('获取所有团队失败', err);
            return [];
        }
    }

    // 获取单个团队详情（包含成员列表）
    async function fetchTeamDetail(teamId) {
        try {
            const { data: team, error } = await supabase
                .from('teams')
                .select('*')
                .eq('id', teamId)
                .single();
            if (error || !team) return null;

            let creatorName = '未知';
            if (team.created_by) {
                const { data: profile } = await supabase
                    .from('profiles')
                    .select('username')
                    .eq('user_id', team.created_by)
                    .maybeSingle();
                creatorName = profile?.username || '未知';
            }

            const { data: memberRows } = await supabase
                .from('team_members')
                .select('user_id')
                .eq('team_id', teamId);

            const userIds = (memberRows || []).map(m => m.user_id);
            let memberList = [];
            if (userIds.length > 0) {
                const { data: profiles } = await supabase
                    .from('profiles')
                    .select('user_id, username')
                    .in('user_id', userIds);
                memberList = (memberRows || []).map(m => {
                    const p = profiles?.find(pr => pr.user_id === m.user_id);
                    return { user_id: m.user_id, username: p?.username || '未知' };
                });
            }
            return {
                ...team,
                creator_name: creatorName,
                members: memberList
            };
        } catch (err) {
            console.error('获取团队详情失败', err);
            return null;
        }
    }

    // 获取指定团队的所有工单（含创建者用户名）
    async function fetchTeamTickets(teamId) {
        try {
            const { data: tickets, error } = await supabase
                .from('tickets')
                .select('*')
                .eq('team_id', teamId)
                .order('created_at', { ascending: false });
            if (error) throw error;

            // 为每个工单获取创建者用户名
            const withCreator = await Promise.all((tickets || []).map(async (t) => {
                let creatorName = '未知';
                if (t.created_by) {
                    const { data: profile } = await supabase
                        .from('profiles')
                        .select('username')
                        .eq('user_id', t.created_by)
                        .maybeSingle();
                    creatorName = profile?.username || '未知';
                }
                return { ...t, creator_name: creatorName };
            }));
            return withCreator;
        } catch (err) {
            console.error('获取团队工单失败', err);
            return [];
        }
    }

    // 获取工单详情（包含创建者用户名）
    async function fetchTicketDetail(ticketId) {
        try {
            const { data: ticket, error } = await supabase
                .from('tickets')
                .select('*, teams(name)')
                .eq('id', ticketId)
                .single();
            if (error || !ticket) return null;

            let creatorName = '未知';
            if (ticket.created_by) {
                const { data: profile } = await supabase
                    .from('profiles')
                    .select('username')
                    .eq('user_id', ticket.created_by)
                    .maybeSingle();
                creatorName = profile?.username || '未知';
            }
            return {
                ...ticket,
                creator_name: creatorName
            };
        } catch (err) {
            console.error('获取工单详情失败', err);
            return null;
        }
    }

    function isUserInTeam(teamId) {
        return userTeams.some(t => t.id === teamId);
    }

    // 切换工单状态
    async function toggleTicketStatus(ticketId, newStatus) {
        if (!currentUser) return;
        try {
            const { error } = await supabase
                .from('tickets')
                .update({ status: newStatus })
                .eq('id', ticketId);
            if (error) throw error;
            await refreshUserData();
            if (activeTab === 'teamDetail' && selectedTeamId) {
                renderMainContent();
            } else if (activeTab === 'ticketDetail' && selectedTicketId === ticketId) {
                renderMainContent();
            } else {
                renderMainContent();
            }
        } catch (err) {
            alert('切换状态失败: ' + err.message);
        }
    }

    // ---------- 团队操作 ----------
    async function joinTeam(teamId) {
        if (!currentUser) return;
        try {
            const { error } = await supabase
                .from('team_members')
                .insert({ team_id: teamId, user_id: currentUser.id });
            if (error) throw error;
            await refreshUserData();
        } catch (err) {
            alert('加入团队失败: ' + err.message);
        }
    }

    async function deleteTeam(teamId) {
        if (!currentUser) return;
        if (!confirm('确定要删除这个团队吗？所有相关工单和成员记录都将被永久删除。')) return;
        try {
            const { error } = await supabase
                .from('teams')
                .delete()
                .eq('id', teamId)
                .eq('created_by', currentUser.id);
            if (error) throw error;
            alert('团队已删除');
            if (selectedTeamId === teamId) {
                selectedTeamId = null;
                activeTab = 'teams';
            }
            await refreshUserData();
        } catch (err) {
            alert('删除团队失败: ' + err.message);
        }
    }

    async function renameTeam(teamId, newName) {
        if (!newName.trim()) return alert('团队名称不能为空');
        try {
            const { error } = await supabase
                .from('teams')
                .update({ name: newName })
                .eq('id', teamId)
                .eq('created_by', currentUser.id);
            if (error) throw error;
            alert('团队名称已更新');
            modalState = null;
            await refreshUserData();
            renderMainContent();
        } catch (err) {
            alert('重命名失败: ' + err.message);
        }
    }

    // ---------- 工单操作 ----------
    async function deleteTicket(ticketId) {
        if (!currentUser) return;
        if (!confirm('确定要删除这个工单吗？')) return;
        try {
            const { error } = await supabase
                .from('tickets')
                .delete()
                .eq('id', ticketId)
                .eq('created_by', currentUser.id);
            if (error) throw error;
            alert('工单已删除');
            if (selectedTicketId === ticketId) {
                selectedTicketId = null;
                activeTab = 'tickets';
            }
            await refreshUserData();
        } catch (err) {
            alert('删除工单失败: ' + err.message);
        }
    }

    async function updateTicket(ticketId, title, contentMd) {
        if (!title.trim()) return alert('标题不能为空');
        try {
            const { error } = await supabase
                .from('tickets')
                .update({ title, content_md: contentMd })
                .eq('id', ticketId)
                .eq('created_by', currentUser.id);
            if (error) throw error;
            alert('工单已更新');
            modalState = null;
            await refreshUserData();
            renderMainContent();
        } catch (err) {
            alert('更新工单失败: ' + err.message);
        }
    }

    // ---------- 修改密码 ----------
    function showChangePasswordModal() {
        modalState = 'changePassword';
        renderMainContent();
    }

    async function handleChangePassword(oldPassword, newPassword) {
        try {
            const { error: signInError } = await supabase.auth.signInWithPassword({
                email: currentUser.email,
                password: oldPassword
            });
            if (signInError) throw new Error('旧密码错误');

            const { error: updateError } = await supabase.auth.updateUser({
                password: newPassword
            });
            if (updateError) throw updateError;

            alert('密码修改成功');
            modalState = null;
            renderMainContent();
        } catch (err) {
            alert('修改密码失败: ' + err.message);
        }
    }

    // ---------- 注销账号 ----------
    async function handleDeleteAccount() {
        if (!currentUser) return;
        const confirmMsg = '注销账号将永久删除您创建的所有团队、工单以及您的个人信息。此操作不可撤销。确定要继续吗？';
        if (!confirm(confirmMsg)) return;

        try {
            const { error: teamsError } = await supabase
                .from('teams')
                .delete()
                .eq('created_by', currentUser.id);
            if (teamsError) throw teamsError;

            const { error: profileError } = await supabase
                .from('profiles')
                .delete()
                .eq('user_id', currentUser.id);
            if (profileError) throw profileError;

            await supabase.auth.signOut();

            alert('账号已注销');
            currentUser = null;
            userTeams = [];
            allTeams = [];
            tickets = [];
            myTickets = [];
            authView = 'login';
            selectedTeamId = null;
            selectedTicketId = null;
            modalState = null;
            renderAuthScreen();
        } catch (err) {
            alert('注销失败: ' + err.message);
        }
    }

    // ---------- 重新加载用户数据 ----------
    async function refreshUserData() {
        if (!currentUser) return;

        // 获取已加入的团队
        const { data: memberRows, error: teamError } = await supabase
            .from('team_members')
            .select('team_id, teams(*)')
            .eq('user_id', currentUser.id);
        if (teamError) {
            console.error(teamError);
            userTeams = [];
        } else {
            userTeams = (memberRows || []).map(r => r.teams).filter(t => t);
        }

        // 获取所属团队的工单（用于团队工单页）
        if (userTeams.length > 0) {
            const teamIds = userTeams.map(t => t.id);
            const { data: tix, error: tixError } = await supabase
                .from('tickets')
                .select('*')
                .in('team_id', teamIds)
                .order('created_at', { ascending: false })
                .limit(50);
            if (tixError) {
                console.error(tixError);
                tickets = [];
            } else {
                // 为每个工单获取创建者用户名
                tickets = await Promise.all((tix || []).map(async (t) => {
                    let creatorName = '未知';
                    if (t.created_by) {
                        const { data: profile } = await supabase
                            .from('profiles')
                            .select('username')
                            .eq('user_id', t.created_by)
                            .maybeSingle();
                        creatorName = profile?.username || '未知';
                    }
                    // 获取团队名称
                    let teamName = '未知';
                    if (t.team_id) {
                        const { data: team } = await supabase
                            .from('teams')
                            .select('name')
                            .eq('id', t.team_id)
                            .single();
                        teamName = team?.name || '未知';
                    }
                    return { ...t, creator_name: creatorName, teams: { name: teamName } };
                }));
            }
        } else {
            tickets = [];
        }

        // 获取当前用户创建的所有工单（用于“我的工单”）
        const { data: myTix, error: myTixError } = await supabase
            .from('tickets')
            .select('*')
            .eq('created_by', currentUser.id)
            .order('created_at', { ascending: false });
        if (myTixError) {
            console.error(myTixError);
            myTickets = [];
        } else {
            myTickets = await Promise.all((myTix || []).map(async (t) => {
                let creatorName = '未知';
                if (t.created_by) {
                    const { data: profile } = await supabase
                        .from('profiles')
                        .select('username')
                        .eq('user_id', t.created_by)
                        .maybeSingle();
                    creatorName = profile?.username || '未知';
                }
                let teamName = '未知';
                if (t.team_id) {
                    const { data: team } = await supabase
                        .from('teams')
                        .select('name')
                        .eq('id', t.team_id)
                        .single();
                    teamName = team?.name || '未知';
                }
                return { ...t, creator_name: creatorName, teams: { name: teamName } };
            }));
        }

        // 获取所有团队
        allTeams = await fetchAllTeams();

        renderMainContent();
    }

    // ---------- 认证 ----------
    async function handleLogin(username, password) {
        try {
            const { data: profile, error: profileError } = await supabase
                .from('profiles')
                .select('email')
                .eq('username', username)
                .maybeSingle();

            if (profileError || !profile) {
                throw new Error('用户名不存在');
            }

            const { data, error } = await supabase.auth.signInWithPassword({
                email: profile.email,
                password: password
            });

            if (error) throw error;
            currentUser = data.user;
            await refreshUserData();
        } catch (err) {
            alert('登录失败: ' + err.message);
        }
    }

    async function handleRegister(username, password) {
        try {
            const email = `${username}@ticket.example`;

            const { data, error } = await supabase.auth.signUp({
                email: email,
                password: password
            });

            if (error) throw error;

            if (data.user) {
                const { error: profileError } = await supabase
                    .from('profiles')
                    .insert({
                        user_id: data.user.id,
                        username: username,
                        email: email
                    });

                if (profileError) {
                    throw new Error('用户名已被使用，请换一个');
                }

                if (data.session) {
                    currentUser = data.user;
                    await refreshUserData();
                } else {
                    alert('注册成功，请登录');
                    authView = 'login';
                    renderAuthScreen();
                }
            } else {
                alert('注册成功，请登录');
                authView = 'login';
                renderAuthScreen();
            }
        } catch (err) {
            alert('注册失败: ' + err.message);
        }
    }

    async function handleLogout() {
        destroyMarkdownEditor();
        await supabase.auth.signOut();
        currentUser = null;
        userTeams = [];
        allTeams = [];
        tickets = [];
        myTickets = [];
        authView = 'login';
        selectedTeamId = null;
        selectedTicketId = null;
        modalState = null;
        renderAuthScreen();
    }

    // 创建团队
    async function createTeam(teamName) {
        if (!teamName.trim()) return alert('团队名称不能为空');
        try {
            const { data: newTeam, error: teamErr } = await supabase
                .from('teams')
                .insert({ name: teamName, created_by: currentUser.id })
                .select()
                .single();
            if (teamErr) throw teamErr;
            await supabase.from('team_members').insert({ team_id: newTeam.id, user_id: currentUser.id });
            await refreshUserData();
            activeTab = 'teams';
            selectedTeamId = null;
        } catch (err) {
            alert('创建团队失败: ' + err.message);
        }
    }

    // 提交工单
    async function submitTicket(title, teamId, contentMd) {
        if (!title.trim()) return alert('请输入标题');
        if (!teamId) return alert('请选择团队');
        try {
            await supabase.from('tickets').insert({
                title, content_md: contentMd || '', team_id: teamId,
                created_by: currentUser.id, status: 'open'
            });
            alert('工单已提交');
            if (easyMDEditor) easyMDEditor.value('');
            document.getElementById('ticket-title') && (document.getElementById('ticket-title').value = '');
            await refreshUserData();
            activeTab = 'tickets';
        } catch (err) {
            alert('提交工单失败: ' + err.message);
        }
    }

    // ---------- 渲染函数 ----------
    function renderAuthScreen() {
        const html = `
            <div class="auth-form">
                <h2>${authView === 'login' ? '登录到工单' : '注册新账号'}</h2>
                <div class="input-group">
                    <label>用户名</label>
                    <input type="text" id="auth-username" placeholder="your_username" autocomplete="off">
                </div>
                <div class="input-group">
                    <label>密码</label>
                    <input type="password" id="auth-password" placeholder="••••••••">
                </div>
                <div class="flex" style="justify-content: space-between;">
                    <button class="btn btn-primary" id="auth-submit-btn">${authView === 'login' ? '登录' : '注册'}</button>
                    <button class="btn btn-outline" id="auth-switch-btn">${authView === 'login' ? '创建新账号' : '返回登录'}</button>
                </div>
            </div>
        `;
        appEl.innerHTML = html;

        document.getElementById('auth-submit-btn')?.addEventListener('click', () => {
            const username = document.getElementById('auth-username').value.trim();
            const password = document.getElementById('auth-password').value;
            if (!username || !password) return alert('请输入用户名和密码');
            if (authView === 'login') handleLogin(username, password);
            else handleRegister(username, password);
        });

        document.getElementById('auth-switch-btn')?.addEventListener('click', () => {
            authView = authView === 'login' ? 'register' : 'login';
            renderAuthScreen();
        });
    }

    // 渲染团队详情页
    async function renderTeamDetail(teamId) {
        const team = await fetchTeamDetail(teamId);
        if (!team) {
            alert('团队不存在');
            activeTab = 'teams';
            selectedTeamId = null;
            renderMainContent();
            return;
        }
        const isMember = isUserInTeam(team.id);
        const isCreator = currentUser && team.created_by === currentUser.id;
        const memberList = team.members.map(m => `<div><i class="fa-regular fa-user"></i> ${escapeHtml(m.username)}</div>`).join('') || '<div>暂无成员</div>';

        const teamTickets = await fetchTeamTickets(teamId);
        const openTickets = teamTickets.filter(t => t.status === 'open');
        const closedTickets = teamTickets.filter(t => t.status === 'closed');
        const expanded = closedTicketsExpanded[teamId] || false;

        const openTicketsHtml = openTickets.map(t => `
            <div class="ticket-item" style="margin-bottom: 0.5rem; cursor: pointer;" data-ticket-id="${t.id}">
                <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                    <div>
                        <div class="ticket-title">${escapeHtml(t.title)}</div>
                        <div class="ticket-meta">
                            <span>创建者: ${escapeHtml(t.creator_name)}</span>
                            <span><i class="fa-regular fa-clock"></i> ${new Date(t.created_at).toLocaleDateString()}</span>
                        </div>
                    </div>
                    ${isMember ? `
                        <button class="btn btn-sm btn-outline" onclick="event.stopPropagation(); window.toggleTicketStatus('${t.id}', 'closed')">
                            <i class="fa-regular fa-circle-check"></i> 关闭
                        </button>
                    ` : ''}
                </div>
            </div>
        `).join('') || '<p class="empty-state">暂无开启的工单</p>';

        const closedTicketsHtml = closedTickets.map(t => `
            <div class="ticket-item" style="margin-bottom: 0.5rem; cursor: pointer;" data-ticket-id="${t.id}">
                <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                    <div>
                        <div class="ticket-title">${escapeHtml(t.title)}</div>
                        <div class="ticket-meta">
                            <span>创建者: ${escapeHtml(t.creator_name)}</span>
                            <span><i class="fa-regular fa-clock"></i> ${new Date(t.created_at).toLocaleDateString()}</span>
                        </div>
                    </div>
                    ${isMember ? `
                        <button class="btn btn-sm btn-outline" onclick="event.stopPropagation(); window.toggleTicketStatus('${t.id}', 'open')">
                            <i class="fa-regular fa-circle"></i> 开启
                        </button>
                    ` : ''}
                </div>
            </div>
        `).join('') || '<p class="empty-state">暂无关闭的工单</p>';

        return `
            <div>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                    <button class="btn btn-outline" id="back-to-teams">返回团队列表</button>
                    <div>
                        ${isCreator ? `
                            <button class="btn btn-outline" id="rename-team-btn" style="margin-right: 0.5rem;"><i class="fa-regular fa-pen-to-square"></i> 重命名</button>
                            <button class="btn btn-danger" id="delete-team-btn"><i class="fa-regular fa-trash-can"></i> 删除团队</button>
                        ` : ''}
                    </div>
                </div>
                <div style="margin-top: 1.5rem;">
                    <h2>${escapeHtml(team.name)}</h2>
                    <p><strong>创建者：</strong> ${escapeHtml(team.creator_name)}</p>
                    <p><strong>成员 (${team.members.length})：</strong></p>
                    <div style="background: #f8fafc; border-radius: 1.5rem; padding: 1.5rem; margin: 1rem 0;">
                        ${memberList}
                    </div>
                    ${!isMember ? `<button class="btn btn-primary" id="join-from-detail">加入团队</button>` : ''}

                    <div style="margin-top: 2rem;">
                        <h3>📋 团队工单</h3>
                        <div style="margin-top: 1rem;">
                            <h4>开启中 (${openTickets.length})</h4>
                            <div style="margin-bottom: 1rem;">
                                ${openTicketsHtml}
                            </div>
                            <div>
                                <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 0.5rem;">
                                    <h4>已关闭 (${closedTickets.length})</h4>
                                    <button class="btn btn-sm btn-outline" id="toggle-closed-tickets">
                                        ${expanded ? '收起' : '展开'}
                                    </button>
                                </div>
                                <div id="closed-tickets-list" style="display: ${expanded ? 'block' : 'none'};">
                                    ${closedTicketsHtml}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // 渲染工单详情页
    async function renderTicketDetail(ticketId) {
        const ticket = await fetchTicketDetail(ticketId);
        if (!ticket) return null;

        let renderedContent = '';
        try {
            if (typeof marked !== 'undefined' && marked.parse) {
                renderedContent = marked.parse(ticket.content_md || '');
            } else {
                renderedContent = `<pre>${escapeHtml(ticket.content_md || '')}</pre>`;
            }
        } catch (e) {
            renderedContent = `<pre>${escapeHtml(ticket.content_md || '')}</pre>`;
        }

        const isCreator = currentUser && ticket.created_by === currentUser.id;
        const isMember = isUserInTeam(ticket.team_id);

        return `
            <div>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                    <button class="btn btn-outline" id="back-to-tickets">返回</button>
                    <div>
                        ${isMember ? `
                            <button class="btn btn-outline" id="toggle-status-btn" style="margin-right: 0.5rem;">
                                ${ticket.status === 'open' ? '<i class="fa-regular fa-circle-check"></i> 关闭' : '<i class="fa-regular fa-circle"></i> 开启'}
                            </button>
                        ` : ''}
                        ${isCreator ? `
                            <button class="btn btn-outline" id="edit-ticket-btn" style="margin-right: 0.5rem;"><i class="fa-regular fa-pen-to-square"></i> 编辑</button>
                            <button class="btn btn-danger" id="delete-ticket-btn"><i class="fa-regular fa-trash-can"></i> 删除</button>
                        ` : ''}
                    </div>
                </div>
                <div style="margin-top: 1.5rem;">
                    <h2>${escapeHtml(ticket.title)}</h2>
                    <div style="display: flex; gap: 1rem; color: #64748b; margin: 1rem 0; flex-wrap: wrap;">
                        <span><i class="fa-regular fa-user"></i> ${escapeHtml(ticket.creator_name)}</span>
                        <span><i class="fa-regular fa-clock"></i> ${new Date(ticket.created_at).toLocaleString()}</span>
                        <span class="team-badge">${escapeHtml(ticket.teams?.name || '未知团队')}</span>
                        <span>状态: ${ticket.status === 'open' ? '开启' : '关闭'}</span>
                    </div>
                    <div style="background: white; border-radius: 1.5rem; padding: 1.5rem; border: 1px solid #e2e8f0;">
                        <div class="markdown-body">${renderedContent}</div>
                    </div>
                </div>
            </div>
        `;
    }

    // 渲染主界面
    async function renderMainContent() {
        if (!currentUser) return renderAuthScreen();

        const displayName = currentUser.email ? currentUser.email.split('@')[0] : '用户';

        const headerHtml = `
            <div class="header">
                <div class="logo"><h1>🎫 工单·团队</h1></div>
                <div class="user-info">
                    <i class="fa-regular fa-circle-user" style="color:#2563eb;"></i> ${displayName}
                    <button class="btn btn-ghost" id="change-password-btn" title="修改密码"><i class="fa-solid fa-gear"></i></button>
                    <button class="btn btn-outline btn-danger" id="logout-btn"><i class="fa-solid fa-sign-out-alt"></i> 退出</button>
                </div>
            </div>
        `;

        const tabsHtml = `
            <div class="tabs">
                <span class="tab ${activeTab === 'tickets' || activeTab === 'ticketDetail' ? 'active' : ''}" data-tab="tickets"><i class="fa-regular fa-list-alt"></i> 团队工单</span>
                <span class="tab ${activeTab === 'myTickets' ? 'active' : ''}" data-tab="myTickets"><i class="fa-regular fa-user"></i> 我的工单</span>
                <span class="tab ${activeTab === 'submit' ? 'active' : ''}" data-tab="submit"><i class="fa-regular fa-pen-to-square"></i> 提交工单</span>
                <span class="tab ${activeTab === 'teams' || activeTab === 'teamDetail' ? 'active' : ''}" data-tab="teams"><i class="fa fa-users"></i> 团队广场</span>
            </div>
        `;

        let contentHtml = '';

        if (activeTab === 'tickets') {
            if (tickets.length === 0) {
                contentHtml = `<div class="empty-state"><p>暂无工单，提交一张吧</p></div>`;
            } else {
                contentHtml = tickets.map(t => `
                    <div class="ticket-item" style="cursor: pointer;" data-ticket-id="${t.id}">
                        <div>
                            <div class="ticket-title">${escapeHtml(t.title)}</div>
                            <div class="ticket-meta">
                                <span class="team-badge">${escapeHtml(t.teams?.name || '未知团队')}</span>
                                <span>创建者: ${escapeHtml(t.creator_name)}</span>
                                <span>状态: ${t.status === 'open' ? '开启' : '关闭'}</span>
                                <span><i class="fa-regular fa-clock"></i> ${new Date(t.created_at).toLocaleDateString()}</span>
                            </div>
                        </div>
                    </div>
                `).join('');
            }
        } else if (activeTab === 'myTickets') {
            if (myTickets.length === 0) {
                contentHtml = `<div class="empty-state"><p>您还没有创建过工单</p></div>`;
            } else {
                contentHtml = myTickets.map(t => `
                    <div class="ticket-item" style="cursor: pointer;" data-ticket-id="${t.id}">
                        <div>
                            <div class="ticket-title">${escapeHtml(t.title)}</div>
                            <div class="ticket-meta">
                                <span class="team-badge">${escapeHtml(t.teams?.name || '未知团队')}</span>
                                <span>状态: ${t.status === 'open' ? '开启' : '关闭'}</span>
                                <span><i class="fa-regular fa-clock"></i> ${new Date(t.created_at).toLocaleDateString()}</span>
                            </div>
                        </div>
                    </div>
                `).join('');
            }
        } else if (activeTab === 'submit') {
            const teamOptions = '<option value="">选择团队</option>' + 
                allTeams.map(t => `<option value="${t.id}">${escapeHtml(t.name)} (${t.creator_name})</option>`).join('');

            contentHtml = `
                <div style="max-width: 800px;">
                    <h3>📝 提交新工单</h3>
                    <div class="input-group">
                        <label>标题</label>
                        <input type="text" id="ticket-title" placeholder="例如：服务器无法连接">
                    </div>
                    <div class="input-group">
                        <label>选择团队</label>
                        <select id="ticket-team">${teamOptions}</select>
                    </div>
                    <div class="markdown-editor-wrapper">
                        <textarea id="ticket-content-md">输入 **Markdown** 内容</textarea>
                    </div>
                    <button class="btn btn-primary" id="submit-ticket-btn">提交工单</button>
                </div>
            `;
        } else if (activeTab === 'teams') {
            const joinedTeams = allTeams.filter(t => isUserInTeam(t.id));
            const joinedHtml = joinedTeams.length ? joinedTeams.map(t => `
                <div class="ticket-item" style="cursor: pointer;" data-team-id="${t.id}">
                    <div>
                        <div class="ticket-title">${escapeHtml(t.name)}</div>
                        <div class="ticket-meta">
                            <span>创建者: ${escapeHtml(t.creator_name)}</span>
                            <span>成员: ${t.member_count}</span>
                            <span class="team-badge">已加入</span>
                        </div>
                    </div>
                </div>
            `).join('') : '<p class="empty-state">您还没有加入任何团队</p>';

            const otherTeams = allTeams.filter(t => !isUserInTeam(t.id));
            const otherHtml = otherTeams.length ? otherTeams.map(t => `
                <div class="ticket-item" style="cursor: pointer;" data-team-id="${t.id}">
                    <div>
                        <div class="ticket-title">${escapeHtml(t.name)}</div>
                        <div class="ticket-meta">
                            <span>创建者: ${escapeHtml(t.creator_name)}</span>
                            <span>成员: ${t.member_count}</span>
                        </div>
                    </div>
                    <div class="flex">
                        <button class="btn btn-primary join-btn" data-team-id="${t.id}">加入</button>
                    </div>
                </div>
            `).join('') : '<p class="empty-state">暂无其他团队</p>';

            contentHtml = `
                <div>
                    <h3>✅ 我的团队</h3>
                    <div class="team-list-wrapper" style="margin-bottom: 2rem;">
                        ${joinedHtml}
                    </div>
                    <div class="divider"></div>
                    <h3>🌐 所有团队</h3>
                    <div class="team-list-wrapper">
                        ${otherHtml}
                    </div>
                    <div class="divider"></div>
                    <h4>创建新团队</h4>
                    <div class="flex">
                        <input type="text" id="new-team-name" placeholder="团队名称" style="padding:0.8rem; border-radius:30px; border:1px solid #e2e8f0; flex:1;">
                        <button class="btn btn-primary" id="create-team-btn">创建</button>
                    </div>
                </div>
            `;
        } else if (activeTab === 'teamDetail' && selectedTeamId) {
            contentHtml = `<div style="text-align: center; padding: 3rem;"><i class="fas fa-spinner fa-pulse fa-2x"></i></div>`;
            setTimeout(async () => {
                try {
                    const detailHtml = await renderTeamDetail(selectedTeamId);
                    const detailContainer = document.getElementById('team-detail-container');
                    if (detailContainer) detailContainer.innerHTML = detailHtml;
                    document.getElementById('back-to-teams')?.addEventListener('click', () => {
                        activeTab = 'teams';
                        selectedTeamId = null;
                        renderMainContent();
                    });
                    const joinBtn = document.getElementById('join-from-detail');
                    if (joinBtn) {
                        joinBtn.addEventListener('click', () => {
                            joinTeam(selectedTeamId);
                        });
                    }
                    const deleteBtn = document.getElementById('delete-team-btn');
                    if (deleteBtn) {
                        deleteBtn.addEventListener('click', () => {
                            deleteTeam(selectedTeamId);
                        });
                    }
                    const renameBtn = document.getElementById('rename-team-btn');
                    if (renameBtn) {
                        renameBtn.addEventListener('click', () => {
                            modalState = 'renameTeam';
                            renderMainContent();
                        });
                    }
                    const toggleBtn = document.getElementById('toggle-closed-tickets');
                    if (toggleBtn) {
                        toggleBtn.addEventListener('click', () => {
                            closedTicketsExpanded[selectedTeamId] = !closedTicketsExpanded[selectedTeamId];
                            renderMainContent();
                        });
                    }
                    document.querySelectorAll('[data-ticket-id]').forEach(el => {
                        el.addEventListener('click', (e) => {
                            if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
                            const ticketId = el.dataset.ticketId;
                            selectedTicketId = ticketId;
                            activeTab = 'ticketDetail';
                            renderMainContent();
                        });
                    });
                } catch (e) {
                    console.error('加载团队详情失败', e);
                    const detailContainer = document.getElementById('team-detail-container');
                    if (detailContainer) detailContainer.innerHTML = `<div class="error-message">加载失败，请重试</div>`;
                }
            }, 0);
            contentHtml = `<div id="team-detail-container">${contentHtml}</div>`;
        } else if (activeTab === 'ticketDetail' && selectedTicketId) {
            contentHtml = `<div style="text-align: center; padding: 3rem;"><i class="fas fa-spinner fa-pulse fa-2x"></i></div>`;
            setTimeout(async () => {
                try {
                    const detailHtml = await renderTicketDetail(selectedTicketId);
                    const detailContainer = document.getElementById('ticket-detail-container');
                    if (detailHtml === null) {
                        detailContainer.innerHTML = `<div class="error-message">工单不存在或已被删除</div>`;
                    } else {
                        detailContainer.innerHTML = detailHtml;
                        document.getElementById('back-to-tickets')?.addEventListener('click', () => {
                            if (activeTab === 'ticketDetail') {
                                activeTab = 'tickets';
                                selectedTicketId = null;
                            }
                            renderMainContent();
                        });
                        const deleteBtn = document.getElementById('delete-ticket-btn');
                        if (deleteBtn) {
                            deleteBtn.addEventListener('click', () => {
                                deleteTicket(selectedTicketId);
                            });
                        }
                        const editBtn = document.getElementById('edit-ticket-btn');
                        if (editBtn) {
                            editBtn.addEventListener('click', () => {
                                modalState = 'editTicket';
                                renderMainContent();
                            });
                        }
                        const toggleBtn = document.getElementById('toggle-status-btn');
                        if (toggleBtn) {
                            const ticket = await fetchTicketDetail(selectedTicketId);
                            const newStatus = ticket.status === 'open' ? 'closed' : 'open';
                            toggleBtn.addEventListener('click', () => {
                                toggleTicketStatus(selectedTicketId, newStatus);
                            });
                        }
                    }
                } catch (e) {
                    console.error('加载工单详情失败', e);
                    const detailContainer = document.getElementById('ticket-detail-container');
                    if (detailContainer) detailContainer.innerHTML = `<div class="error-message">加载失败，请重试</div>`;
                }
            }, 0);
            contentHtml = `<div id="ticket-detail-container">${contentHtml}</div>`;
        }

        let finalHtml = headerHtml + tabsHtml + `<div style="margin-top: 2rem;">${contentHtml}</div>`;

        // 模态框处理（与之前相同）
        if (modalState === 'changePassword') {
            finalHtml += `
                <div class="modal-overlay" id="modal-overlay">
                    <div class="modal-card">
                        <h3>修改密码</h3>
                        <div class="input-group">
                            <label>旧密码</label>
                            <input type="password" id="old-password" placeholder="••••••••">
                        </div>
                        <div class="input-group">
                            <label>新密码</label>
                            <input type="password" id="new-password" placeholder="••••••••">
                        </div>
                        <div class="input-group">
                            <label>确认新密码</label>
                            <input type="password" id="confirm-password" placeholder="••••••••">
                        </div>
                        <div class="modal-actions" style="flex-direction: column; gap: 0.5rem;">
                            <div style="display: flex; gap: 1rem; width: 100%;">
                                <button class="btn btn-outline" id="cancel-modal" style="flex:1;">取消</button>
                                <button class="btn btn-primary" id="confirm-change-password" style="flex:1;">确认修改</button>
                            </div>
                            <button class="btn btn-danger" id="delete-account-btn" style="width: 100%;">注销账号</button>
                        </div>
                    </div>
                </div>
            `;
        }

        if (modalState === 'renameTeam') {
            const currentTeam = allTeams.find(t => t.id === selectedTeamId) || { name: '' };
            finalHtml += `
                <div class="modal-overlay" id="modal-overlay">
                    <div class="modal-card">
                        <h3>重命名团队</h3>
                        <div class="input-group">
                            <label>新团队名称</label>
                            <input type="text" id="new-team-name-input" placeholder="输入新名称" value="${escapeHtml(currentTeam.name)}">
                        </div>
                        <div class="modal-actions">
                            <button class="btn btn-outline" id="cancel-modal">取消</button>
                            <button class="btn btn-primary" id="confirm-rename">确认</button>
                        </div>
                    </div>
                </div>
            `;
        }

        if (modalState === 'editTicket') {
            const currentTicket = tickets.find(t => t.id === selectedTicketId) || myTickets.find(t => t.id === selectedTicketId) || { title: '', content_md: '' };
            finalHtml += `
                <div class="modal-overlay" id="modal-overlay">
                    <div class="modal-card" style="max-width: 600px;">
                        <h3>编辑工单</h3>
                        <div class="input-group">
                            <label>标题</label>
                            <input type="text" id="edit-ticket-title" value="${escapeHtml(currentTicket.title)}">
                        </div>
                        <div class="input-group">
                            <label>内容 (Markdown)</label>
                            <textarea id="edit-ticket-content-md">${escapeHtml(currentTicket.content_md || '')}</textarea>
                        </div>
                        <div class="modal-actions">
                            <button class="btn btn-outline" id="cancel-modal">取消</button>
                            <button class="btn btn-primary" id="confirm-edit-ticket">保存修改</button>
                        </div>
                    </div>
                </div>
            `;
        }

        appEl.innerHTML = finalHtml;

        // 全局事件绑定
        document.getElementById('logout-btn')?.addEventListener('click', handleLogout);
        document.getElementById('change-password-btn')?.addEventListener('click', showChangePasswordModal);

        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const newTab = e.currentTarget.dataset.tab;
                if (newTab) {
                    if (activeTab === 'submit' && newTab !== 'submit') destroyMarkdownEditor();
                    activeTab = newTab;
                    selectedTeamId = null;
                    selectedTicketId = null;
                    renderMainContent();
                }
            });
        });

        if (activeTab === 'submit') {
            setTimeout(() => initMarkdownEditor('ticket-content-md'), 20);
            document.getElementById('submit-ticket-btn')?.addEventListener('click', () => {
                const title = document.getElementById('ticket-title')?.value;
                const teamId = document.getElementById('ticket-team')?.value;
                const content = easyMDEditor ? easyMDEditor.value() : '';
                submitTicket(title, teamId, content);
            });
        } else if (activeTab === 'teams') {
            document.querySelectorAll('[data-team-id]').forEach(el => {
                el.addEventListener('click', (e) => {
                    if (e.target.classList.contains('join-btn')) return;
                    const teamId = el.dataset.teamId;
                    selectedTeamId = teamId;
                    activeTab = 'teamDetail';
                    renderMainContent();
                });
            });
            document.querySelectorAll('.join-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const teamId = btn.dataset.teamId;
                    joinTeam(teamId);
                });
            });
            document.getElementById('create-team-btn')?.addEventListener('click', () => {
                const name = document.getElementById('new-team-name')?.value;
                createTeam(name);
            });
        } else if (activeTab === 'tickets' || activeTab === 'myTickets') {
            document.querySelectorAll('[data-ticket-id]').forEach(el => {
                el.addEventListener('click', () => {
                    const ticketId = el.dataset.ticketId;
                    selectedTicketId = ticketId;
                    activeTab = 'ticketDetail';
                    renderMainContent();
                });
            });
        }

        // 模态框事件
        if (modalState === 'changePassword') {
            document.getElementById('cancel-modal')?.addEventListener('click', () => {
                modalState = null;
                renderMainContent();
            });
            document.getElementById('confirm-change-password')?.addEventListener('click', async () => {
                const oldPwd = document.getElementById('old-password').value;
                const newPwd = document.getElementById('new-password').value;
                const confirmPwd = document.getElementById('confirm-password').value;
                if (!oldPwd || !newPwd || !confirmPwd) return alert('请填写所有字段');
                if (newPwd !== confirmPwd) return alert('新密码两次输入不一致');
                await handleChangePassword(oldPwd, newPwd);
            });
            document.getElementById('delete-account-btn')?.addEventListener('click', handleDeleteAccount);
        }

        if (modalState === 'renameTeam') {
            document.getElementById('cancel-modal')?.addEventListener('click', () => {
                modalState = null;
                renderMainContent();
            });
            document.getElementById('confirm-rename')?.addEventListener('click', async () => {
                const newName = document.getElementById('new-team-name-input').value;
                await renameTeam(selectedTeamId, newName);
            });
        }

        if (modalState === 'editTicket') {
            setTimeout(() => initMarkdownEditor('edit-ticket-content-md'), 20);
            document.getElementById('cancel-modal')?.addEventListener('click', () => {
                modalState = null;
                renderMainContent();
            });
            document.getElementById('confirm-edit-ticket')?.addEventListener('click', async () => {
                const newTitle = document.getElementById('edit-ticket-title').value;
                const content = easyMDEditor ? easyMDEditor.value() : document.getElementById('edit-ticket-content-md').value;
                await updateTicket(selectedTicketId, newTitle, content);
            });
        }
    }

    function escapeHtml(unsafe) {
        if (!unsafe) return '';
        return unsafe.replace(/[&<>"]/g, m => {
            if (m === '&') return '&amp;';
            if (m === '<') return '&lt;';
            if (m === '>') return '&gt;';
            if (m === '"') return '&quot;';
            return m;
        });
    }

    window.toggleTicketStatus = toggleTicketStatus;

    supabase.auth.getSession().then(({ data: { session } }) => {
        currentUser = session?.user ?? null;
        if (currentUser) refreshUserData(); else renderAuthScreen();
    });

    supabase.auth.onAuthStateChange((event, session) => {
        currentUser = session?.user ?? null;
        if (currentUser) refreshUserData(); else {
            userTeams = [];
            allTeams = [];
            tickets = [];
            myTickets = [];
            destroyMarkdownEditor();
            renderAuthScreen();
        }
    });
})();