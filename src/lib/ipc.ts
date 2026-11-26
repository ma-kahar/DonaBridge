import { invoke } from "@tauri-apps/api/core";

export interface AccountInfo {
  id: string;
  name: string;
  color: string;
  icon_text: string;
  category: string;
  muted: boolean;
  sort_order: number;
  avatar_data_url?: string | null;
  has_lock?: boolean;
  group_id?: string | null;
}

export interface AccountGroupDto {
  id: string;
  name: string;
  color: string;
  sort_order: number;
}

export interface TagDto {
  id: string;
  name: string;
  color: string;
}

export interface ContactDto {
  id: string;
  account_id: string;
  phone_e164: string;
  display_name: string | null;
  stage: string;
  updated_at?: string | null;
}

export interface NoteDto {
  id: string;
  account_id: string;
  contact_id: string | null;
  body: string;
  created_at: string | null;
}

export interface ReminderDto {
  id: string;
  contact_id: string;
  due_at: string | null;
  note: string | null;
  status: string;
}

export interface TemplateDto {
  id: string;
  account_id: string | null;
  name: string;
  body: string;
  language: string;
  shortcut: string | null;
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function listAccounts(): Promise<AccountInfo[]> {
  if (!isTauri()) return [];
  return invoke<AccountInfo[]>("list_accounts");
}

export async function prewarmAccounts(activeId: string | null): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("prewarm_accounts", { activeId });
}

export async function accountSetPin(accountId: string, pin: string): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("account_set_pin", { accountId, pin });
}

export async function accountVerifyPin(accountId: string, pin: string): Promise<boolean> {
  if (!isTauri()) return true;
  return invoke<boolean>("account_verify_pin", { accountId, pin });
}

export async function accountClearPin(accountId: string): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("account_clear_pin", { accountId });
}

export async function upsertAccount(info: AccountInfo): Promise<AccountInfo> {
  if (!isTauri()) {
    // Browser preview: keep the account in React state so the UI can be viewed
    // outside the desktop shell.
    return { ...info, id: info.id || `preview-${Date.now()}` };
  }
  return invoke<AccountInfo>("upsert_account", { info });
}

export async function deleteAccount(id: string): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("delete_account", { id });
}

export async function switchAccount(id: string): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("switch_account", { id });
}

export async function listAccountGroups(): Promise<AccountGroupDto[]> {
  if (!isTauri()) return [];
  return invoke<AccountGroupDto[]>("list_account_groups");
}

export async function upsertAccountGroup(group: AccountGroupDto): Promise<AccountGroupDto> {
  if (!isTauri()) return group;
  return invoke<AccountGroupDto>("upsert_account_group", { group });
}

export async function deleteAccountGroup(id: string): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("delete_account_group", { id });
}

export async function reorderAccounts(ids: string[]): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("reorder_accounts", { ids });
}

export async function setOverlayOpen(open: boolean, activeAccountId: string | null): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("set_overlay_open", { open, activeAccountId });
}

// ── CRM IPC ──────────────────────────────────────────────────────────────────

export async function crmListContacts(accountId: string): Promise<ContactDto[]> {
  if (!isTauri()) return [];
  return invoke<ContactDto[]>("crm_list_contacts", { accountId });
}

export async function crmUpsertContact(contact: ContactDto): Promise<ContactDto> {
  if (!isTauri()) return contact;
  return invoke<ContactDto>("crm_upsert_contact", { contact });
}

export async function crmDeleteContact(id: string): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("crm_delete_contact", { id });
}

export async function crmListNotes(contactId: string): Promise<NoteDto[]> {
  if (!isTauri()) return [];
  return invoke<NoteDto[]>("crm_list_notes", { contactId });
}

export async function crmAddNote(
  accountId: string,
  contactId: string | null,
  body: string
): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("crm_add_note", { accountId, contactId, body });
}

export async function crmListReminders(accountId: string): Promise<ReminderDto[]> {
  if (!isTauri()) return [];
  return invoke<ReminderDto[]>("crm_list_reminders", { accountId });
}

export async function crmUpsertReminder(reminder: ReminderDto): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("crm_upsert_reminder", { reminder });
}

export async function crmListTemplates(accountId: string | null): Promise<TemplateDto[]> {
  if (!isTauri()) return [];
  return invoke<TemplateDto[]>("crm_list_templates", { accountId });
}

export async function crmUpsertTemplate(template: TemplateDto): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("crm_upsert_template", { template });
}

export async function crmDeleteTemplate(id: string): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("crm_delete_template", { id });
}

export async function crmExportCsv(accountId: string): Promise<string> {
  if (!isTauri()) return "";
  return invoke<string>("crm_export_csv", { accountId });
}

export interface CrmFileResult {
  path: string;
  bytes: number;
  rows: number;
}

export interface CrmImportSummary {
  contacts: number;
  deals: number;
  tasks: number;
  notes: number;
  tags: number;
  templates: number;
  pipelines: number;
  total_rows: number;
}

export async function crmExportJson(path: string): Promise<CrmFileResult> {
  if (!isTauri()) throw new Error("Export is only available in the desktop app");
  return invoke<CrmFileResult>("crm_export_json", { path });
}

export async function crmImportJson(path: string): Promise<CrmImportSummary> {
  if (!isTauri()) throw new Error("Import is only available in the desktop app");
  return invoke<CrmImportSummary>("crm_import_json", { path });
}

export async function crmHasData(): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("crm_has_data");
}

export async function crmExportDealsCsv(
  accountId: string,
  path: string
): Promise<CrmFileResult> {
  if (!isTauri()) throw new Error("Export is only available in the desktop app");
  return invoke<CrmFileResult>("crm_export_deals_csv", { accountId, path });
}

export async function crmExportTasksCsv(
  accountId: string,
  path: string
): Promise<CrmFileResult> {
  if (!isTauri()) throw new Error("Export is only available in the desktop app");
  return invoke<CrmFileResult>("crm_export_tasks_csv", { accountId, path });
}

export async function crmInsertDraft(accountId: string, text: string): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("crm_insert_draft", { accountId, text });
}

export async function crmOpenChat(accountId: string, phone: string): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("crm_open_chat", { accountId, phone });
}

export async function crmSetDrawerOpen(open: boolean): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("crm_set_drawer_open", { open });
}

export async function crmListTags(): Promise<TagDto[]> {
  if (!isTauri()) return [];
  return invoke<TagDto[]>("crm_list_tags");
}

export async function crmUpsertTag(tag: TagDto): Promise<TagDto> {
  if (!isTauri()) return tag;
  return invoke<TagDto>("crm_upsert_tag", { tag });
}

export async function crmListContactTags(contactId: string): Promise<TagDto[]> {
  if (!isTauri()) return [];
  return invoke<TagDto[]>("crm_list_contact_tags", { contactId });
}

export async function crmAssignTag(contactId: string, tagId: string): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("crm_assign_tag", { contactId, tagId });
}

export async function crmRemoveTag(contactId: string, tagId: string): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("crm_remove_tag", { contactId, tagId });
}

export async function crmImportCsv(accountId: string, csvText: string): Promise<number> {
  if (!isTauri()) return 0;
  return invoke<number>("crm_import_csv", { accountId, csvText });
}

// ── LiteCRM IPC: pipelines, deals, fields, tasks, timeline, reports ──────────

export interface PipelineDto {
  id: string;
  name: string;
  is_default: boolean;
  sort_order: number;
}

export interface PipelineStageDto {
  id: string;
  pipeline_id: string;
  name: string;
  color: string;
  sort_order: number;
  wip_limit: number;
  is_won: boolean;
  is_lost: boolean;
}

export interface PipelineWithStagesDto {
  pipeline: PipelineDto;
  stages: PipelineStageDto[];
}

export interface DealDto {
  id: string;
  account_id: string;
  contact_id?: string | null;
  pipeline_id: string;
  stage_id: string;
  title: string;
  value: number;
  currency: string;
  probability: number;
  expected_close?: string | null;
  owner?: string | null;
  status: string;
  lost_reason?: string | null;
  sort_order: number;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface CustomFieldDto {
  id: string;
  account_id?: string | null;
  name: string;
  field_type: string;
  options?: string | null;
  sort_order: number;
}

export interface ContactFieldValueDto {
  field_id: string;
  value: string;
}

export interface CrmTaskDto {
  id: string;
  account_id: string;
  contact_id?: string | null;
  deal_id?: string | null;
  title: string;
  notes?: string | null;
  due_at?: string | null;
  priority: string;
  status: string;
  notified: boolean;
  completed_at?: string | null;
  created_at?: string | null;
}

export interface TimelineEntryDto {
  id: string;
  kind: string;
  title: string;
  body: string;
  at?: string | null;
}

export interface StageReportDto {
  stage_id: string;
  name: string;
  color: string;
  count: number;
  value: number;
}

export interface CrmReportDto {
  pipeline_id: string;
  pipeline_name: string;
  currency: string;
  stages: StageReportDto[];
  open_count: number;
  open_value: number;
  won_count: number;
  won_value: number;
  lost_count: number;
  lost_value: number;
  win_rate: number;
  avg_deal_value: number;
  open_tasks: number;
  overdue_tasks: number;
  deals_last_30_days: number;
  won_last_30_days: number;
}

export async function crmListPipelines(): Promise<PipelineWithStagesDto[]> {
  if (!isTauri()) return [];
  return invoke<PipelineWithStagesDto[]>("crm_list_pipelines");
}

export async function crmUpsertPipeline(pipeline: PipelineDto): Promise<PipelineDto> {
  if (!isTauri()) return pipeline;
  return invoke<PipelineDto>("crm_upsert_pipeline", { pipeline });
}

export async function crmDeletePipeline(id: string): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("crm_delete_pipeline", { id });
}

export async function crmUpsertStage(stage: PipelineStageDto): Promise<PipelineStageDto> {
  if (!isTauri()) return stage;
  return invoke<PipelineStageDto>("crm_upsert_stage", { stage });
}

export async function crmDeleteStage(id: string): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("crm_delete_stage", { id });
}

export async function crmListDeals(accountId: string, pipelineId: string): Promise<DealDto[]> {
  if (!isTauri()) return [];
  return invoke<DealDto[]>("crm_list_deals", { accountId, pipelineId });
}

export async function crmUpsertDeal(deal: DealDto): Promise<DealDto> {
  if (!isTauri()) return deal;
  return invoke<DealDto>("crm_upsert_deal", { deal });
}

export async function crmMoveDeal(
  id: string,
  stageId: string,
  sortOrder: number
): Promise<DealDto> {
  if (!isTauri()) throw new Error("Deals are only available in the desktop app");
  return invoke<DealDto>("crm_move_deal", { id, stageId, sortOrder });
}

export async function crmDeleteDeal(id: string): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("crm_delete_deal", { id });
}

export async function crmListCustomFields(accountId: string): Promise<CustomFieldDto[]> {
  if (!isTauri()) return [];
  return invoke<CustomFieldDto[]>("crm_list_custom_fields", { accountId });
}

export async function crmUpsertCustomField(field: CustomFieldDto): Promise<CustomFieldDto> {
  if (!isTauri()) return field;
  return invoke<CustomFieldDto>("crm_upsert_custom_field", { field });
}

export async function crmDeleteCustomField(id: string): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("crm_delete_custom_field", { id });
}

export async function crmGetContactFields(contactId: string): Promise<ContactFieldValueDto[]> {
  if (!isTauri()) return [];
  return invoke<ContactFieldValueDto[]>("crm_get_contact_fields", { contactId });
}

export async function crmSetContactField(
  contactId: string,
  fieldId: string,
  value: string
): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("crm_set_contact_field", { contactId, fieldId, value });
}

export async function crmListTasks(accountId: string): Promise<CrmTaskDto[]> {
  if (!isTauri()) return [];
  return invoke<CrmTaskDto[]>("crm_list_tasks", { accountId });
}

export async function crmUpsertTask(task: CrmTaskDto): Promise<CrmTaskDto> {
  if (!isTauri()) return task;
  return invoke<CrmTaskDto>("crm_upsert_task", { task });
}

export async function crmDeleteTask(id: string): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("crm_delete_task", { id });
}

export async function crmContactTimeline(contactId: string): Promise<TimelineEntryDto[]> {
  if (!isTauri()) return [];
  return invoke<TimelineEntryDto[]>("crm_contact_timeline", { contactId });
}

export async function crmReport(accountId: string, pipelineId: string): Promise<CrmReportDto> {
  if (!isTauri()) throw new Error("Reports are only available in the desktop app");
  return invoke<CrmReportDto>("crm_report", { accountId, pipelineId });
}

// ── Security & Secrets IPC ───────────────────────────────────────────────────

export interface LockStatus {
  locked: boolean;
  has_pin: boolean;
  hello_available: boolean;
}

export async function securityLockStatus(): Promise<LockStatus> {
  if (!isTauri()) return { locked: false, has_pin: false, hello_available: false };
  return invoke<LockStatus>("security_lock_status");
}

export async function securitySetPin(pin: string): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("security_set_pin", { pin });
}

export async function securityClearPin(): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("security_clear_pin");
}

export async function securityLockApp(): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("security_lock_app");
}

export async function securityUnlockPin(pin: string): Promise<boolean> {
  if (!isTauri()) return true;
  return invoke<boolean>("security_unlock_pin", { pin });
}

export async function securityUnlockHello(): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("security_unlock_hello");
}

export async function secretSet(keyName: string, value: string): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("secret_set", { keyName, value });
}

export async function secretHas(keyName: string): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("secret_has", { keyName });
}

export async function secretDelete(keyName: string): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("secret_delete", { keyName });
}

// ── AI Copilot IPC ───────────────────────────────────────────────────────────

export interface AiConfig {
  provider: string;
  model: string;
  base_url: string;
  cloud_consent: boolean;
}

export async function aiGetConfig(): Promise<AiConfig> {
  if (!isTauri()) {
    return {
      provider: "ollama",
      model: "llama3.2",
      base_url: "http://localhost:11434",
      cloud_consent: false,
    };
  }
  return invoke<AiConfig>("ai_get_config");
}

export async function aiSaveConfig(config: AiConfig): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("ai_save_config", { config });
}

export async function aiReadActiveChat(accountId: string): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("ai_read_active_chat", { accountId });
}

export async function aiSuggestReply(
  accountId: string,
  contact: string,
  messages: string[],
  tone: string,
  language: string
): Promise<string> {
  if (!isTauri()) return "";
  return invoke<string>("ai_suggest_reply", { accountId, contact, messages, tone, language });
}

export interface AiProfile {
  id: string;
  name: string;
  provider: string;
  model: string;
  base_url: string;
  active: boolean;
  has_key: boolean;
}

export async function aiListProfiles(): Promise<AiProfile[]> {
  if (!isTauri()) return [];
  return invoke<AiProfile[]>("ai_list_profiles");
}

export async function aiUpsertProfile(profile: AiProfile, apiKey?: string): Promise<AiProfile[]> {
  if (!isTauri()) return [profile];
  return invoke<AiProfile[]>("ai_upsert_profile", { profile, apiKey: apiKey || null });
}

export async function aiSetActiveProfile(id: string): Promise<AiProfile[]> {
  if (!isTauri()) return [];
  return invoke<AiProfile[]>("ai_set_active_profile", { id });
}

export async function aiDeleteProfile(id: string): Promise<AiProfile[]> {
  if (!isTauri()) return [];
  return invoke<AiProfile[]>("ai_delete_profile", { id });
}

export async function aiDetectModels(
  provider: string,
  baseUrl: string,
  profileId?: string,
  apiKeyOverride?: string
): Promise<string[]> {
  if (!isTauri()) return [];
  return invoke<string[]>("ai_detect_models", {
    provider,
    baseUrl,
    profileId: profileId || null,
    apiKeyOverride: apiKeyOverride || null,
  });
}

// ── Link Preview IPC ─────────────────────────────────────────────────────────

export interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
}

const _linkPreviewCache = new Map<string, LinkPreview>();

export async function fetchLinkPreview(url: string): Promise<LinkPreview | null> {
  if (_linkPreviewCache.has(url)) return _linkPreviewCache.get(url) ?? null;
  if (!isTauri()) return null;
  try {
    const preview = await invoke<LinkPreview>("fetch_link_preview", { url });
    _linkPreviewCache.set(url, preview);
    return preview;
  } catch {
    return null;
  }
}

// ── DND Schedule IPC ──────────────────────────────────────────────────────────

export async function setDndSchedule(
  accountId: string,
  startHhmm: string,
  endHhmm: string
): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("set_dnd_schedule", { accountId, startHhmm, endHhmm });
}

export async function clearDndSchedule(accountId: string): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("clear_dnd_schedule", { accountId });
}

// ── Backup / Restore / Health IPC ─────────────────────────────────────────────

export interface BackupResult {
  path: string;
  bytes: number;
  accounts: number;
}

export interface RestoreResult {
  accounts: number;
}

export interface SnapshotInfo {
  path: string;
  bytes: number;
  created_at?: string | null;
}

export interface HealthReport {
  data_dir: string;
  db_path: string;
  db_bytes: number;
  wal_bytes: number;
  log_dir: string;
  backups_bytes: number;
  account_count: number;
  group_count: number;
  webview_profiles: number;
  webview_bytes: number;
  version: string;
  os: string;
  unclean_shutdown: boolean;
  integrity_ok: boolean;
  recovery_notice: string | null;
  snapshots: SnapshotInfo[];
}

export async function backupEncrypted(
  password: string,
  destination: string
): Promise<BackupResult> {
  if (!isTauri()) throw new Error("Backups are only available in the desktop app");
  return invoke<BackupResult>("backup_encrypted", { password, destination });
}

export async function restoreEncrypted(path: string, password: string): Promise<RestoreResult> {
  if (!isTauri()) throw new Error("Restores are only available in the desktop app");
  return invoke<RestoreResult>("restore_encrypted", { path, password });
}

export async function appHealth(): Promise<HealthReport | null> {
  if (!isTauri()) return null;
  return invoke<HealthReport>("app_health");
}

export async function createSnapshot(): Promise<string> {
  if (!isTauri()) throw new Error("Snapshots are only available in the desktop app");
  return invoke<string>("create_snapshot");
}

export async function restoreSnapshot(path: string): Promise<RestoreResult> {
  if (!isTauri()) throw new Error("Restores are only available in the desktop app");
  return invoke<RestoreResult>("restore_snapshot", { path });
}

export async function exportDiagnostics(): Promise<string> {
  if (!isTauri()) throw new Error("Diagnostics are only available in the desktop app");
  return invoke<string>("export_diagnostics");
}

export interface AutoBackupSettings {
  enabled: boolean;
  folder: string;
  interval_hours: number;
  keep: number;
  has_key: boolean;
  last_backup_at?: string | null;
  last_error?: string | null;
  count: number;
  bytes: number;
  suggested_folder?: string | null;
}

export async function autoBackupSettings(): Promise<AutoBackupSettings | null> {
  if (!isTauri()) return null;
  return invoke<AutoBackupSettings>("auto_backup_settings");
}

export async function saveAutoBackupSettings(
  settings: AutoBackupSettings
): Promise<AutoBackupSettings> {
  if (!isTauri()) throw new Error("Backups are only available in the desktop app");
  return invoke<AutoBackupSettings>("save_auto_backup_settings", { settings });
}

export async function createAutoBackupNow(): Promise<BackupResult> {
  if (!isTauri()) throw new Error("Backups are only available in the desktop app");
  return invoke<BackupResult>("create_auto_backup_now");
}

export async function backupRecoveryCode(): Promise<string> {
  if (!isTauri()) throw new Error("Backups are only available in the desktop app");
  return invoke<string>("backup_recovery_code");
}

export interface WebhookSettings {
  enabled: boolean;
  url: string;
  events: string[];
  has_secret: boolean;
  last_at?: string | null;
  last_status?: string | null;
  last_error?: string | null;
}

export interface WebhookTestResult {
  ok: boolean;
  status?: number | null;
  response: string;
  error?: string | null;
}

export async function webhookSettings(): Promise<WebhookSettings | null> {
  if (!isTauri()) return null;
  return invoke<WebhookSettings>("webhook_settings");
}

export async function saveWebhookSettings(
  settings: WebhookSettings
): Promise<WebhookSettings> {
  if (!isTauri()) throw new Error("Webhooks are only available in the desktop app");
  return invoke<WebhookSettings>("save_webhook_settings", { settings });
}

export async function webhookSecret(): Promise<string | null> {
  if (!isTauri()) return null;
  return invoke<string | null>("webhook_secret");
}

export async function rotateWebhookSecret(): Promise<string> {
  if (!isTauri()) throw new Error("Webhooks are only available in the desktop app");
  return invoke<string>("rotate_webhook_secret");
}

export async function testWebhook(): Promise<WebhookTestResult> {
  if (!isTauri()) throw new Error("Webhooks are only available in the desktop app");
  return invoke<WebhookTestResult>("test_webhook");
}

export interface WebDavSettings {
  enabled: boolean;
  url: string;
  username: string;
  interval_hours: number;
  keep: number;
  has_password: boolean;
  last_at?: string | null;
  last_status?: string | null;
  last_error?: string | null;
  last_file?: string | null;
}

export interface WebDavTestResult {
  ok: boolean;
  status?: number | null;
  error?: string | null;
}

export interface WebDavUpload {
  file: string;
  bytes: number;
  status: number;
}

export async function webdavSettings(): Promise<WebDavSettings | null> {
  if (!isTauri()) return null;
  return invoke<WebDavSettings>("webdav_settings");
}

export async function saveWebdavSettings(
  settings: WebDavSettings,
  password: string | null
): Promise<WebDavSettings> {
  if (!isTauri()) throw new Error("WebDAV upload is only available in the desktop app");
  return invoke<WebDavSettings>("save_webdav_settings", { settings, password });
}

export async function webdavTest(): Promise<WebDavTestResult> {
  if (!isTauri()) throw new Error("WebDAV upload is only available in the desktop app");
  return invoke<WebDavTestResult>("webdav_test");
}

export async function webdavUploadNow(): Promise<WebDavUpload> {
  if (!isTauri()) throw new Error("WebDAV upload is only available in the desktop app");
  return invoke<WebDavUpload>("webdav_upload_now");
}

export async function setBackupRecoveryCode(code: string): Promise<void> {
  if (!isTauri()) throw new Error("Backups are only available in the desktop app");
  return invoke<void>("set_backup_recovery_code", { code });
}

// ── MCP Server IPC ───────────────────────────────────────────────────────────

export interface McpStatus {
  running: boolean;
  port: number | null;
  has_token: boolean;
}

export async function mcpStatus(): Promise<McpStatus> {
  if (!isTauri()) return { running: false, port: null, has_token: false };
  return invoke<McpStatus>("mcp_status");
}

export async function mcpStart(): Promise<McpStatus> {
  if (!isTauri()) return { running: false, port: null, has_token: false };
  return invoke<McpStatus>("mcp_start");
}

export async function mcpStop(): Promise<McpStatus> {
  if (!isTauri()) return { running: false, port: null, has_token: false };
  return invoke<McpStatus>("mcp_stop");
}

export async function mcpRotateToken(): Promise<string> {
  if (!isTauri()) return "";
  return invoke<string>("mcp_rotate_token");
}
