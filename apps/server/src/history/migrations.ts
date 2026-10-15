/**
 * 数据表迁移定义（SRP）。
 * 每个迁移是不可变的已发布历史：只允许追加新的版本，禁止改动既有 SQL；
 * 表结构的完整说明见 docs/features/history-storage.md。
 */

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly statements: readonly string[];
}

/** 迁移 1：比赛、副、分支、动作节点、评估、配置版本、座位绑定。 */
const MIGRATION_1: Migration = {
  version: 1,
  name: 'history_core',
  statements: [
    `CREATE TABLE matches (
       match_id TEXT PRIMARY KEY,
       started_at INTEGER NOT NULL,
       ended_at INTEGER,
       source TEXT NOT NULL,
       status TEXT NOT NULL,
       target_wins INTEGER NOT NULL,
       rule_set_id TEXT NOT NULL,
       rule_version INTEGER NOT NULL,
       app_version TEXT,
       implementation_version TEXT
     )`,
    `CREATE INDEX idx_matches_started ON matches(started_at DESC)`,
    `CREATE INDEX idx_matches_status ON matches(status, started_at DESC)`,

    `CREATE TABLE hands (
       hand_id TEXT PRIMARY KEY,
       match_id TEXT NOT NULL REFERENCES matches(match_id),
       hand_index INTEGER NOT NULL,
       start_snapshot TEXT NOT NULL,
       started_at INTEGER NOT NULL,
       ended_at INTEGER,
       declarer INTEGER,
       bid INTEGER,
       trump TEXT,
       result TEXT,
       unplayed_points INTEGER,
       UNIQUE (match_id, hand_index)
     )`,
    `CREATE INDEX idx_hands_match ON hands(match_id, hand_index)`,

    `CREATE TABLE branches (
       branch_id TEXT PRIMARY KEY,
       hand_id TEXT NOT NULL REFERENCES hands(hand_id),
       source_node_id TEXT,
       name TEXT NOT NULL,
       tip_node_id TEXT,
       kind TEXT NOT NULL,
       created_at INTEGER NOT NULL
     )`,
    `CREATE INDEX idx_branches_hand ON branches(hand_id, created_at)`,

    `CREATE TABLE action_nodes (
       node_id TEXT PRIMARY KEY,
       branch_id TEXT NOT NULL REFERENCES branches(branch_id),
       parent_id TEXT,
       seq INTEGER NOT NULL,
       command TEXT NOT NULL,
       source TEXT NOT NULL,
       state TEXT NOT NULL,
       state_digest TEXT NOT NULL,
       checkpoint_id TEXT,
       created_at INTEGER NOT NULL
     )`,
    `CREATE INDEX idx_nodes_branch_seq ON action_nodes(branch_id, seq)`,
    `CREATE INDEX idx_nodes_parent ON action_nodes(parent_id)`,

    `CREATE TABLE evaluations (
       evaluation_id TEXT PRIMARY KEY,
       node_id TEXT NOT NULL REFERENCES action_nodes(node_id),
       request_id TEXT NOT NULL UNIQUE,
       session_id TEXT NOT NULL,
       seat INTEGER NOT NULL,
       phase TEXT NOT NULL,
       purpose TEXT,
       observation TEXT NOT NULL,
       candidates TEXT,
       recommended TEXT,
       status TEXT NOT NULL,
       latency_ms INTEGER NOT NULL,
       profile_version_id TEXT,
       model_name TEXT,
       engine_type TEXT,
       fallback_reason TEXT,
       error_details TEXT,
       created_at INTEGER NOT NULL
     )`,
    `CREATE INDEX idx_evaluations_node ON evaluations(node_id, created_at)`,

    `CREATE TABLE profile_versions (
       profile_version_id TEXT PRIMARY KEY,
       profile_id TEXT NOT NULL,
       version TEXT NOT NULL,
       config_hash TEXT NOT NULL,
       type TEXT NOT NULL,
       name TEXT NOT NULL,
       parameters TEXT NOT NULL,
       implementation_version TEXT,
       created_at INTEGER NOT NULL,
       UNIQUE (profile_id, config_hash)
     )`,
    `CREATE INDEX idx_profile_versions_profile ON profile_versions(profile_id, created_at)`,

    `CREATE TABLE seat_assignments (
       assignment_id TEXT PRIMARY KEY,
       hand_id TEXT NOT NULL REFERENCES hands(hand_id),
       branch_id TEXT NOT NULL REFERENCES branches(branch_id),
       node_id TEXT,
       seat INTEGER NOT NULL,
       kind TEXT NOT NULL,
       profile_version_id TEXT,
       created_at INTEGER NOT NULL
     )`,
    `CREATE INDEX idx_assignments_hand ON seat_assignments(hand_id, branch_id, created_at)`,
  ],
};

/** 迁移 2：补全图外键、节点序号唯一与领域边界；保留 v1 SQL 便于真实旧库升级。 */
const MIGRATION_2: Migration = {
  version: 2,
  name: 'history_integrity',
  statements: [
    `CREATE TABLE branches_v2 (
      branch_id TEXT PRIMARY KEY,
      hand_id TEXT NOT NULL REFERENCES hands(hand_id),
      source_node_id TEXT REFERENCES action_nodes_v2(node_id),
      name TEXT NOT NULL,
      tip_node_id TEXT REFERENCES action_nodes_v2(node_id),
      kind TEXT NOT NULL CHECK(kind IN ('actual','branch')),
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE action_nodes_v2 (
      node_id TEXT PRIMARY KEY,
      branch_id TEXT NOT NULL REFERENCES branches_v2(branch_id),
      parent_id TEXT REFERENCES action_nodes_v2(node_id),
      seq INTEGER NOT NULL CHECK(seq >= 0),
      command TEXT NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('human','manual','ai','hint')),
      state TEXT NOT NULL,
      state_digest TEXT NOT NULL,
      checkpoint_id TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE(branch_id,seq)
    )`,
    `CREATE TABLE evaluations_v2 (
      evaluation_id TEXT PRIMARY KEY,
      node_id TEXT NOT NULL REFERENCES action_nodes_v2(node_id),
      request_id TEXT NOT NULL UNIQUE,
      session_id TEXT NOT NULL,
      seat INTEGER NOT NULL CHECK(seat BETWEEN 0 AND 3),
      phase TEXT NOT NULL CHECK(phase IN ('bidding','trump','bury','playing','handEnd','matchEnd')),
      purpose TEXT,
      observation TEXT NOT NULL,
      candidates TEXT,
      recommended TEXT,
      status TEXT NOT NULL CHECK(status IN ('evaluated','applied','stale')),
      latency_ms INTEGER NOT NULL CHECK(latency_ms >= 0),
      profile_version_id TEXT REFERENCES profile_versions(profile_version_id),
      model_name TEXT,
      engine_type TEXT,
      fallback_reason TEXT,
      error_details TEXT,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE seat_assignments_v2 (
      assignment_id TEXT PRIMARY KEY,
      hand_id TEXT NOT NULL REFERENCES hands(hand_id),
      branch_id TEXT NOT NULL REFERENCES branches_v2(branch_id),
      node_id TEXT REFERENCES action_nodes_v2(node_id),
      seat INTEGER NOT NULL CHECK(seat BETWEEN 0 AND 3),
      kind TEXT NOT NULL CHECK(kind IN ('human','ai')),
      profile_version_id TEXT REFERENCES profile_versions(profile_version_id),
      created_at INTEGER NOT NULL
    )`,
    'INSERT INTO branches_v2 SELECT * FROM branches',
    'INSERT INTO action_nodes_v2 SELECT * FROM action_nodes',
    'INSERT INTO evaluations_v2 SELECT * FROM evaluations',
    'INSERT INTO seat_assignments_v2 SELECT * FROM seat_assignments',
    'DROP TABLE evaluations',
    'DROP TABLE seat_assignments',
    'DROP TABLE action_nodes',
    'DROP TABLE branches',
    'ALTER TABLE branches_v2 RENAME TO branches',
    'ALTER TABLE action_nodes_v2 RENAME TO action_nodes',
    'ALTER TABLE evaluations_v2 RENAME TO evaluations',
    'ALTER TABLE seat_assignments_v2 RENAME TO seat_assignments',
    'CREATE INDEX idx_branches_hand ON branches(hand_id,created_at)',
    'CREATE INDEX idx_nodes_parent ON action_nodes(parent_id)',
    'CREATE INDEX idx_evaluations_node ON evaluations(node_id,created_at)',
    'CREATE INDEX idx_assignments_hand ON seat_assignments(hand_id,branch_id,created_at)',
    ...(['INSERT','UPDATE'] as const).flatMap(operation => [
      `CREATE TRIGGER branches_scope_${operation.toLowerCase()} BEFORE ${operation} ON branches BEGIN
        SELECT CASE WHEN NEW.source_node_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM action_nodes n JOIN branches b ON b.branch_id=n.branch_id
          WHERE n.node_id=NEW.source_node_id AND b.hand_id=NEW.hand_id
        ) THEN RAISE(ABORT,'branch source belongs to another hand') END;
        SELECT CASE WHEN NEW.tip_node_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM action_nodes n WHERE n.node_id=NEW.tip_node_id AND n.branch_id=NEW.branch_id
        ) THEN RAISE(ABORT,'branch tip belongs to another branch') END;
      END`,
      `CREATE TRIGGER assignments_scope_${operation.toLowerCase()} BEFORE ${operation} ON seat_assignments BEGIN
        SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM branches b WHERE b.branch_id=NEW.branch_id AND b.hand_id=NEW.hand_id)
          THEN RAISE(ABORT,'assignment branch belongs to another hand') END;
        SELECT CASE WHEN NEW.node_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM action_nodes n WHERE n.node_id=NEW.node_id AND n.branch_id=NEW.branch_id
        ) THEN RAISE(ABORT,'assignment node belongs to another branch') END;
      END`,
    ]),
  ],
};

/** 迁移 3：不可变配置、真实路径唯一、按持久节点隔离请求及版本化诊断 JSON。 */
const MIGRATION_3: Migration = {
  version: 3,
  name: 'history_identity_and_observations',
  statements: [
    "CREATE UNIQUE INDEX idx_actual_branch ON branches(hand_id) WHERE kind='actual'",
    'CREATE UNIQUE INDEX idx_profile_version ON profile_versions(profile_id,version)',
    `CREATE TABLE evaluations_v3 (
      evaluation_id TEXT PRIMARY KEY,
      node_id TEXT NOT NULL REFERENCES action_nodes(node_id),
      request_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      seat INTEGER NOT NULL CHECK(seat BETWEEN 0 AND 3),
      phase TEXT NOT NULL CHECK(phase IN ('bidding','trump','bury','playing','handEnd','matchEnd')),
      purpose TEXT CHECK(purpose IS NULL OR purpose IN ('prefetch','hint','step','auto')),
      observation TEXT NOT NULL,
      candidates TEXT,
      recommended TEXT,
      status TEXT NOT NULL CHECK(status IN ('evaluated','applied','stale')),
      latency_ms INTEGER NOT NULL CHECK(latency_ms >= 0),
      profile_version_id TEXT REFERENCES profile_versions(profile_version_id),
      model_name TEXT,
      engine_type TEXT,
      fallback_reason TEXT,
      error_details TEXT,
      created_at INTEGER NOT NULL,
      observation_point TEXT NOT NULL CHECK(observation_point IN ('before','after')),
      UNIQUE(node_id,request_id)
    )`,
    `INSERT INTO evaluations_v3 SELECT evaluation_id,node_id,request_id,session_id,seat,phase,purpose,
      json_object('v',2,'data',json(observation)),
      CASE WHEN candidates IS NULL THEN NULL ELSE json_object('v',2,'data',json(candidates)) END,
      CASE WHEN recommended IS NULL THEN NULL ELSE json_object('v',2,'data',json(recommended)) END,
      status,latency_ms,profile_version_id,model_name,engine_type,fallback_reason,error_details,created_at,'after'
      FROM evaluations`,
    'DROP TABLE evaluations',
    'ALTER TABLE evaluations_v3 RENAME TO evaluations',
    'CREATE INDEX idx_evaluations_node ON evaluations(node_id,created_at)',
    "UPDATE profile_versions SET parameters=json_object('v',2,'data',json(parameters))",
    ...(['INSERT', 'UPDATE'] as const).flatMap(operation => [
      `CREATE TRIGGER matches_values_${operation.toLowerCase()} BEFORE ${operation} ON matches BEGIN
        SELECT CASE WHEN typeof(NEW.target_wins)<>'integer' OR NEW.target_wins<1
          OR NEW.status NOT IN ('in_progress','completed','abandoned','failed')
          OR NEW.source NOT IN ('human','ai','bench','simulation','import')
          THEN RAISE(ABORT,'invalid match values') END;
      END`,
      `CREATE TRIGGER hands_values_${operation.toLowerCase()} BEFORE ${operation} ON hands BEGIN
        SELECT CASE WHEN typeof(NEW.hand_index)<>'integer' OR NEW.hand_index<0
          THEN RAISE(ABORT,'invalid hand index') END;
      END`,
      `CREATE TRIGGER assignments_profile_${operation.toLowerCase()} BEFORE ${operation} ON seat_assignments BEGIN
        SELECT CASE WHEN (NEW.kind='ai' AND NEW.profile_version_id IS NULL)
          OR (NEW.kind='human' AND NEW.profile_version_id IS NOT NULL)
          THEN RAISE(ABORT,'invalid assignment profile') END;
      END`,
    ]),
  ],
};

/** 迁移 4：首个合法动作前的评估附在副/分支起点，避免为保存建议伪造动作。 */
const MIGRATION_4: Migration = {
  version: 4, name: 'initial_evaluations', statements: [
    'ALTER TABLE evaluations ADD COLUMN applied_node_id TEXT REFERENCES action_nodes(node_id)',
    `CREATE TABLE initial_evaluations (
      evaluation_id TEXT PRIMARY KEY,
      branch_id TEXT NOT NULL REFERENCES branches(branch_id),
      request_id TEXT NOT NULL,
      profile_version_id TEXT REFERENCES profile_versions(profile_version_id),
      status TEXT NOT NULL CHECK(status IN ('evaluated','applied','stale')),
      data TEXT NOT NULL,
      applied_node_id TEXT REFERENCES action_nodes(node_id),
      UNIQUE(branch_id,request_id)
    )`,
  ],
};
/** 迁移 5：模拟元数据与组进度，动作仍共用历史节点事务。 */
const MIGRATION_5: Migration = { version: 5, name: 'simulation_runs', statements: [
  `CREATE TABLE simulation_runs (run_id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, data TEXT NOT NULL)`,
  `CREATE TABLE simulation_boards (board_id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES simulation_runs(run_id), board_index INTEGER NOT NULL, data TEXT NOT NULL, UNIQUE(run_id,board_index))`,
] };
export const MIGRATIONS: readonly Migration[] = [MIGRATION_1, MIGRATION_2, MIGRATION_3, MIGRATION_4, MIGRATION_5];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
