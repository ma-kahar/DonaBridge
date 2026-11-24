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
  if (!isTauri()) return info;
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

export async function crmInsertDraft(accountId: string, text: string): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("crm_insert_draft", { accountId, text });
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
  contact: string,
  messages: string[],
  tone: string,
  language: string
): Promise<string> {
  if (!isTauri()) return "";
  return invoke<string>("ai_suggest_reply", { contact, messages, tone, language });
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

// ── Backup / Restore IPC ──────────────────────────────────────────────────────

export async function backupEncrypted(password: string): Promise<string> {
  if (!isTauri()) return "";
  return invoke<string>("backup_encrypted", { password });
}

export async function restoreEncrypted(path: string, password: string): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("restore_encrypted", { path, password });
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
