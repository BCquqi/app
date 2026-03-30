-- ============================================
-- 工单系统完整 SQL（最终版）
-- 包含所有表的创建和行级安全策略
-- 团队成员只能更新工单，不能管理团队
-- ============================================

-- 1. 创建 profiles 表（存储用户名到内部邮箱的映射）
CREATE TABLE IF NOT EXISTS profiles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
    username TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "允许匿名查询用户名和邮箱" ON profiles;
DROP POLICY IF EXISTS "用户可管理自己的 profile" ON profiles;

CREATE POLICY "允许匿名查询用户名和邮箱" ON profiles
    FOR SELECT USING (true);

CREATE POLICY "用户可管理自己的 profile" ON profiles
    FOR ALL USING (auth.uid() = user_id);

-- ============================================

-- 2. 创建 teams 表
CREATE TABLE IF NOT EXISTS teams (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE teams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "允许所有已认证用户查看团队" ON teams;
DROP POLICY IF EXISTS "允许用户创建团队" ON teams;
DROP POLICY IF EXISTS "允许创建者删除团队" ON teams;
DROP POLICY IF EXISTS "允许创建者更新团队" ON teams;

CREATE POLICY "允许所有已认证用户查看团队" ON teams
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "允许用户创建团队" ON teams
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);

CREATE POLICY "允许创建者删除团队" ON teams
    FOR DELETE TO authenticated
    USING (auth.uid() = created_by);

CREATE POLICY "允许创建者更新团队" ON teams
    FOR UPDATE TO authenticated
    USING (auth.uid() = created_by)
    WITH CHECK (auth.uid() = created_by);

-- ============================================

-- 3. 创建 team_members 表
CREATE TABLE IF NOT EXISTS team_members (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(team_id, user_id)
);

ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "允许所有已认证用户查看成员" ON team_members;
DROP POLICY IF EXISTS "允许用户加入团队" ON team_members;

CREATE POLICY "允许所有已认证用户查看成员" ON team_members
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "允许用户加入团队" ON team_members
    FOR INSERT TO authenticated WITH CHECK (true);

-- ============================================

-- 4. 创建 tickets 表
CREATE TABLE IF NOT EXISTS tickets (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL,
    content_md TEXT,
    team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
    created_by UUID REFERENCES auth.users(id),
    status TEXT DEFAULT 'open',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "允许所有已认证用户查看工单" ON tickets;
DROP POLICY IF EXISTS "允许用户创建工单" ON tickets;
DROP POLICY IF EXISTS "允许创建者更新工单" ON tickets;
DROP POLICY IF EXISTS "允许创建者删除工单" ON tickets;
DROP POLICY IF EXISTS "允许创建者或团队成员更新工单" ON tickets;

CREATE POLICY "允许所有已认证用户查看工单" ON tickets
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "允许用户创建工单" ON tickets
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "允许创建者或团队成员更新工单" ON tickets
    FOR UPDATE TO authenticated
    USING (
        auth.uid() = created_by 
        OR 
        auth.uid() IN (SELECT user_id FROM team_members WHERE team_id = tickets.team_id)
    )
    WITH CHECK (
        auth.uid() = created_by 
        OR 
        auth.uid() IN (SELECT user_id FROM team_members WHERE team_id = tickets.team_id)
    );

CREATE POLICY "允许创建者删除工单" ON tickets
    FOR DELETE TO authenticated
    USING (auth.uid() = created_by);

-- ============================================

-- 5. 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username);
CREATE INDEX IF NOT EXISTS idx_teams_created_by ON teams(created_by);
CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user_id ON team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_team_id ON tickets(team_id);
CREATE INDEX IF NOT EXISTS idx_tickets_created_by ON tickets(created_by);
CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON tickets(created_at DESC);