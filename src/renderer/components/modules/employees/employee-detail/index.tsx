import { isThinkingLevel } from "@shared/constants/thinking";
import { t } from "@shared/l10n";
import type {
  Employee,
  EmployeeInput,
  EmployeeProfileExtra,
  ModelOption,
} from "@shared/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { appStore } from "../../../../app-store";
import {
  modelRef,
  thinkingLevelsFor,
  thinkingSelectOptions,
} from "../../../../thinking-options";
import { Button } from "../../../button";
import { employeeAvatarSrc } from "../../../employee-avatar/avatar-src";
import {
  IconCamera,
  IconClock,
  IconEdit,
  IconPlus,
  IconTrash,
} from "../../../icons";
import { Input } from "../../../input";
import { Modal } from "../../../modal";
import { MultiSelect, type MultiSelectOption } from "../../../multi-select";
import { Select } from "../../../select";
import { Textarea } from "../../../textarea";
import { Tooltip } from "../../../tooltip";
import { AvatarCropModal } from "../avatar-crop-modal";
import "./index.css";

export interface EmployeeDetailProps {
  employee: Employee;
  mcpOptions: MultiSelectOption[];
  skillOptions: MultiSelectOption[];
  models: ModelOption[];
  /** App default model (`provider/id`), used when this employee follows it. */
  defaultModel: string;
  onPatch: (input: EmployeeInput) => Promise<boolean>;
  onRemove: () => void;
  /** Called when the avatar file is replaced (keeps appStore in sync). */
  onAvatarUpdated?: (employee: Employee) => void;
}

const SAVE_DEBOUNCE_MS = 400;

function IconFlip(): React.JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 21h5v-5" />
    </svg>
  );
}

function IconSendRocket(): React.JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m12 15 2 2 4-4" />
      <path d="M14.5 9a3.5 3.5 0 0 0-5 0l-4.5 4.5 4.5 4.5 4.5-4.5a3.5 3.5 0 0 0 0-5Z" />
      <path d="M19.5 4.5c-3-3-8.5-1-11.5 2L3 11.5l4.5 4.5L12.5 21c3-3 5-8.5 2-11.5l5-5Z" />
      <path d="m9 9 6 6" />
    </svg>
  );
}

function formatDateStr(timestamp: number | null): string {
  if (!timestamp) return "—";
  const d = new Date(timestamp * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDateTimeStr(timestamp: number | null): string {
  if (!timestamp) return "—";
  const d = new Date(timestamp * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

export function EmployeeDetail({
  employee,
  mcpOptions,
  skillOptions,
  models,
  defaultModel,
  onPatch,
  onRemove,
  onAvatarUpdated,
}: EmployeeDetailProps): React.JSX.Element {
  const isAssistant = employee.id === 0;

  const [form, setForm] = useState<EmployeeInput>(
    isAssistant
      ? {
          name: employee.name,
          systemPrompt: employee.systemPrompt,
          skills: employee.skills,
          modelId: employee.modelId ?? "",
          thinkingLevel: employee.thinkingLevel,
        }
      : {
          name: employee.name,
          role: employee.role,
          systemPrompt: employee.systemPrompt,
          mcp: employee.mcp,
          skills: employee.skills,
          modelId: employee.modelId ?? "",
          thinkingLevel: employee.thinkingLevel,
        },
  );

  const [avatar, setAvatar] = useState<string | null>(employee.avatar);
  const [avatarVersion, setAvatarVersion] = useState<number | null>(
    employee.avatarVersion,
  );
  const [avatarAv, setAvatarAv] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [editingField, setEditingField] = useState<"name" | "role" | null>(
    null,
  );
  const [fieldDraft, setFieldDraft] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fieldDoneRef = useRef(false);

  // Extra profile metrics and task history
  const [extra, setExtra] = useState<EmployeeProfileExtra | null>(null);
  const [extraLoading, setExtraLoading] = useState(false);
  const [isFlipped, setIsFlipped] = useState(false);
  const [isTearing, setIsTearing] = useState(false);
  const [summoning, setSummoning] = useState(false);

  const loadExtra = useCallback(() => {
    setExtraLoading(true);
    imb.employees
      .profileExtra(employee.id)
      .then((data) => setExtra(data))
      .catch((err) =>
        console.warn("Failed to load employee profile extra:", err),
      )
      .finally(() => setExtraLoading(false));
  }, [employee.id]);

  useEffect(() => {
    loadExtra();
  }, [loadExtra]);

  const scheduleSave = useCallback(
    (next: EmployeeInput): void => {
      setForm(next);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void onPatch(next);
      }, SAVE_DEBOUNCE_MS);
    },
    [onPatch],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const onAvatarPicked = (file: File | undefined): void => {
    if (!file) return;
    setCropFile(file);
    setCropOpen(true);
    if (fileRef.current) fileRef.current.value = "";
  };

  const onCropConfirm = async (
    croppedData: Uint8Array,
    ext: string,
  ): Promise<void> => {
    setAvatarAv(true);
    setAvatarError(null);
    try {
      const updated = await imb.employees.updateAvatar(
        employee.id,
        ext,
        croppedData,
      );
      if (updated) {
        setAvatar(updated.avatar);
        setAvatarVersion(updated.avatarVersion);
        onAvatarUpdated?.(updated);
      }
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setAvatarAv(false);
    }
  };

  const triggerPicker = (): void => fileRef.current?.click();

  const beginEdit = (field: "name" | "role"): void => {
    fieldDoneRef.current = false;
    setFieldDraft(field === "name" ? (form.name ?? "") : (form.role ?? ""));
    setEditingField(field);
  };

  const cancelEdit = (): void => {
    fieldDoneRef.current = true;
    setEditingField(null);
  };

  const commitEdit = (): void => {
    if (fieldDoneRef.current) return;
    fieldDoneRef.current = true;
    const field = editingField;
    setEditingField(null);
    if (field === null) return;
    const draft = fieldDraft;
    if (field === "name") {
      const next = draft.trim();
      if (next.length === 0 || next === (form.name ?? "").trim()) return;
      scheduleSave({ ...form, name: next });
    } else if (draft !== (form.role ?? "")) {
      scheduleSave({ ...form, role: draft });
    }
  };

  // Holographic sheen mouse tracking
  const handleCardMouseMove = (e: React.MouseEvent<HTMLDivElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    e.currentTarget.style.setProperty("--sheen-x", `${x.toFixed(1)}%`);
    e.currentTarget.style.setProperty("--sheen-y", `${y.toFixed(1)}%`);
  };

  // Dispatch / Start new task with this employee
  const handleDispatchTask = async (): Promise<void> => {
    if (summoning) return;
    setSummoning(true);
    try {
      const chat = await imb.chats.create("", [employee.id]);
      if (chat) {
        await appStore.reloadChats();
        await appStore.focusChat(chat.id);
      }
    } catch (err) {
      console.error("Failed to summon employee into chat:", err);
    } finally {
      setSummoning(false);
    }
  };

  // Tear-off shredding animation on delete
  const executeTearDelete = (): void => {
    setRemoveOpen(false);
    setIsTearing(true);
    setTimeout(() => {
      onRemove();
    }, 650);
  };

  const displayName = (form.name ?? "").trim() || employee.name || t("Unnamed");
  const displayRole = isAssistant ? employee.role || "" : (form.role ?? "");
  const displayAvatarUrl = employeeAvatarSrc({
    id: employee.id,
    avatar,
    avatarVersion,
  });

  const onboardDateStr = useMemo(() => {
    if (!extra?.firstActiveAt) return isAssistant ? t("Permanent") : t("Today");
    return formatDateStr(extra.firstActiveAt);
  }, [extra?.firstActiveAt, isAssistant]);

  const tenureStr = useMemo(() => {
    if (!extra?.firstActiveAt) {
      return isAssistant ? t("Core Assistant") : t("Day 1");
    }
    const start = extra.firstActiveAt * 1000;
    const end =
      employee.disabled && extra.lastActiveAt
        ? extra.lastActiveAt * 1000
        : Date.now();
    const diffDays = Math.max(
      1,
      Math.ceil((end - start) / (1000 * 60 * 60 * 24)),
    );
    if (diffDays < 30) {
      return `${diffDays} ${t("days")}`;
    }
    const months = Math.floor(diffDays / 30);
    const remDays = diffDays % 30;
    return remDays > 0
      ? `${months} ${t("mo")} ${remDays} ${t("d")}`
      : `${months} ${t("mo")}`;
  }, [extra?.firstActiveAt, extra?.lastActiveAt, employee.disabled, isAssistant]);

  const modelShortName = useMemo(() => {
    if (!form.modelId) return t("Default");
    const parts = form.modelId.split("/");
    return parts[parts.length - 1];
  }, [form.modelId]);

  return (
    <div className="imb-employee-card-viewport">
      <div
        className={`imb-employee-card-flipper ${isFlipped ? "is-flipped" : ""} ${isTearing ? "is-tearing" : ""}`}
        onMouseMove={handleCardMouseMove}
      >
        {/* FRONT OF BADGE CARD */}
        <div className="imb-employee-card-face imb-employee-card-front">
          {/* Lanyard punch slot */}
          <div className="imb-card-lanyard-slot" />

          {/* Badge Top Header */}
          <div className="imb-card-top-bar">
            <div className="imb-card-id-chip">
              <span className="imb-card-chip-graphic" />
              <span className="imb-card-id-code">
                {isAssistant ? "EXEC-CDO #000" : `ID-BADGE #${String(employee.id).padStart(3, "0")}`}
              </span>
            </div>

            <div className="imb-card-top-actions">
              <Tooltip content={t("Dispatch Task")}>
                <button
                  type="button"
                  className="imb-card-action-btn imb-card-action-summon"
                  onClick={() => void handleDispatchTask()}
                  disabled={summoning}
                  aria-label={t("Dispatch Task")}
                >
                  <IconSendRocket />
                  <span className="imb-card-action-label">{t("Dispatch")}</span>
                </button>
              </Tooltip>

              <Tooltip content={t("Flip to Task History")}>
                <button
                  type="button"
                  className="imb-card-action-btn imb-card-action-flip"
                  onClick={() => setIsFlipped(true)}
                  aria-label={t("Task History")}
                >
                  <IconFlip />
                  <span className="imb-card-action-label">{t("History")}</span>
                </button>
              </Tooltip>

              {!isAssistant && (
                <Tooltip content={t("Retire/Shred Card")}>
                  <button
                    type="button"
                    className="imb-card-action-btn imb-card-action-danger"
                    onClick={() => setRemoveOpen(true)}
                    aria-label={t("Delete")}
                  >
                    <IconTrash />
                  </button>
                </Tooltip>
              )}
            </div>
          </div>

          {/* Identity & Status Hero */}
          <div className="imb-card-hero">
            <div
              className="imb-card-avatar-wrap"
              role="button"
              tabIndex={0}
              aria-label={t("Change avatar")}
              onClick={triggerPicker}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  triggerPicker();
                }
              }}
            >
              {displayAvatarUrl ? (
                <img
                  className="imb-card-avatar-img"
                  src={displayAvatarUrl}
                  alt={displayName}
                />
              ) : (
                <div className="imb-card-avatar-placeholder">
                  {displayName.slice(0, 1).toUpperCase() || "?"}
                </div>
              )}
              <div className="imb-card-avatar-overlay">
                <IconCamera />
              </div>
              <div
                className={`imb-card-status-dot ${employee.disabled ? "is-disabled" : "is-active"}`}
                title={employee.disabled ? t("Disabled") : t("Active")}
              />
            </div>

            <div className="imb-card-hero-meta">
              <div className="imb-card-title-row">
                <h2>
                  {editingField === "name" ? (
                    <Input
                      className="imb-employee-name-input"
                      value={fieldDraft}
                      autoFocus
                      aria-label={t("Name")}
                      placeholder={t("Unnamed")}
                      onChange={(e) => setFieldDraft(e.target.value)}
                      onFocus={(e) => e.currentTarget.select()}
                      onBlur={commitEdit}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitEdit();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          cancelEdit();
                        }
                      }}
                    />
                  ) : (
                    <Tooltip placement="bottom" content={t("Edit")}>
                      <button
                        type="button"
                        className="imb-employee-edit-line"
                        onClick={() => beginEdit("name")}
                      >
                        <span className="imb-employee-edit-text">
                          {displayName}
                        </span>
                        <IconEdit className="imb-employee-edit-icon" />
                      </button>
                    </Tooltip>
                  )}
                </h2>

                <div className="imb-card-status-pill">
                  {employee.disabled ? (
                    <span className="imb-pill imb-pill-danger">
                      {t("Retired")}
                    </span>
                  ) : isAssistant ? (
                    <span className="imb-pill imb-pill-accent">
                      {t("Permanent")}
                    </span>
                  ) : (
                    <span className="imb-pill imb-pill-success">
                      {t("Active")}
                    </span>
                  )}
                </div>
              </div>

              <div className="imb-card-role-row">
                {isAssistant ? (
                  <div className="imb-sub">{displayRole || "—"}</div>
                ) : editingField === "role" ? (
                  <Input
                    className="imb-employee-role-input"
                    value={fieldDraft}
                    autoFocus
                    aria-label={t("Role")}
                    placeholder={t("e.g. Researcher")}
                    onChange={(e) => setFieldDraft(e.target.value)}
                    onFocus={(e) => e.currentTarget.select()}
                    onBlur={commitEdit}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitEdit();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        cancelEdit();
                      }
                    }}
                  />
                ) : (
                  <Tooltip placement="bottom" content={t("Edit")}>
                    <button
                      type="button"
                      className="imb-sub imb-employee-edit-line"
                      onClick={() => beginEdit("role")}
                    >
                      <span className="imb-employee-edit-text">
                        {displayRole || "—"}
                      </span>
                      <IconEdit className="imb-employee-edit-icon" />
                    </button>
                  </Tooltip>
                )}
              </div>

              {/* Recruitment & Tenure Strip */}
              <div className="imb-card-tenure-strip">
                <span className="imb-tenure-item">
                  <IconClock className="imb-tenure-icon" />
                  {t("Joined")}: {onboardDateStr}
                </span>
                <span className="imb-tenure-sep">·</span>
                <span className="imb-tenure-item">
                  {t("Tenure")}: {tenureStr}
                </span>
              </div>
            </div>

            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              disabled={avatarAv}
              onChange={(e) => void onAvatarPicked(e.target.files?.[0])}
            />
          </div>

          {avatarError !== null && (
            <p className="imb-error-text imb-employee-avatar-error">
              {avatarError}
            </p>
          )}

          {/* Performance HUD Strip */}
          <div className="imb-employee-hud-bar">
            <div className="imb-hud-stat">
              <span className="imb-hud-label">{t("Tasks")}</span>
              <span className="imb-hud-val">
                {extra?.taskCount ?? 0}
                <span className="imb-hud-unit">{t("sessions")}</span>
              </span>
            </div>
            <div className="imb-hud-divider" />
            <div className="imb-hud-stat">
              <span className="imb-hud-label">{t("Messages")}</span>
              <span className="imb-hud-val">
                {extra?.messageCount ?? 0}
                <span className="imb-hud-unit">{t("replies")}</span>
              </span>
            </div>
            <div className="imb-hud-divider" />
            <div className="imb-hud-stat">
              <span className="imb-hud-label">{t("Model")}</span>
              <span className="imb-hud-val imb-hud-val-pill" title={form.modelId || t("Default")}>
                {modelShortName}
              </span>
            </div>
            <div className="imb-hud-divider" />
            <div className="imb-hud-stat">
              <span className="imb-hud-label">{t("Thinking")}</span>
              <span className="imb-hud-val imb-hud-val-pill">
                {form.thinkingLevel || t("Default")}
              </span>
            </div>
          </div>

          {/* Body Fields Section */}
          <div className="imb-card-body-fields">
            {/* System Prompt Section */}
            <div className="imb-card-section">
              <div className="imb-card-section-head">
                <span className="imb-section-title">
                  {t("Persona & Directives")}
                </span>
                {isAssistant && (
                  <span className="imb-section-sub">
                    {t("Appends to built-in system prompt")}
                  </span>
                )}
              </div>
              <Textarea
                id={`emp-prompt-${employee.id}`}
                value={form.systemPrompt ?? ""}
                placeholder={t(
                  "Define this employee's responsibilities, skills, and output standards…",
                )}
                minHeight={160}
                onChange={(e) =>
                  setForm({ ...form, systemPrompt: e.target.value })
                }
                onValueCommit={(systemPrompt) =>
                  scheduleSave({ ...form, systemPrompt })
                }
              />
            </div>

            {/* Skills & MCP Capabilities Section */}
            <div className="imb-card-dual-grid">
              {!isAssistant && (
                <div className="imb-card-section">
                  <div className="imb-card-section-head">
                    <span className="imb-section-title">
                      {t("Linked MCP Tools")}
                    </span>
                  </div>
                  <MultiSelect
                    value={form.mcp ?? []}
                    options={mcpOptions}
                    placeholder={t("Select MCP")}
                    emptyHint={t("No MCP configured")}
                    onChange={(mcp) => scheduleSave({ ...form, mcp })}
                  />
                </div>
              )}

              <div className="imb-card-section">
                <div className="imb-card-section-head">
                  <span className="imb-section-title">{t("Skill Set")}</span>
                </div>
                <MultiSelect
                  value={form.skills ?? []}
                  options={skillOptions}
                  placeholder={t("Select skills")}
                  emptyHint={t("No skills installed")}
                  onChange={(skills) => scheduleSave({ ...form, skills })}
                />
              </div>
            </div>

            {/* Compute & Intelligence Specs */}
            <div className="imb-card-dual-grid">
              <div className="imb-card-section">
                <div className="imb-card-section-head">
                  <span className="imb-section-title">{t("Model")}</span>
                </div>
                <Select
                  id={`emp-model-${employee.id}`}
                  value={form.modelId ?? ""}
                  options={[
                    { value: "", label: t("Default") },
                    ...models.map((model) => ({
                      value: modelRef(model),
                      label: modelRef(model),
                    })),
                  ]}
                  placeholder={t("Default")}
                  onChange={(modelId) =>
                    scheduleSave({ ...form, modelId: modelId || null })
                  }
                />
              </div>

              <div className="imb-card-section">
                <div className="imb-card-section-head">
                  <span className="imb-section-title">
                    {t("Thinking Level")}
                  </span>
                </div>
                <Select
                  id={`emp-thinking-${employee.id}`}
                  value={form.thinkingLevel ?? ""}
                  options={[
                    { value: "", label: t("Default") },
                    ...thinkingSelectOptions(
                      thinkingLevelsFor(
                        models,
                        form.modelId ?? "",
                        defaultModel,
                      ),
                      form.thinkingLevel ?? "",
                    ),
                  ]}
                  onChange={(level) =>
                    scheduleSave({
                      ...form,
                      thinkingLevel: isThinkingLevel(level) ? level : null,
                    })
                  }
                />
              </div>
            </div>
          </div>
        </div>

        {/* BACK OF BADGE CARD (Task History Timeline) */}
        <div className="imb-employee-card-face imb-employee-card-back">
          {/* Lanyard punch slot */}
          <div className="imb-card-lanyard-slot" />

          {/* Back Top Header */}
          <div className="imb-card-top-bar">
            <div className="imb-card-id-chip">
              <span className="imb-card-chip-graphic" />
              <span className="imb-card-id-code">
                {t("CAREER LOGS & TASKS")} · #{String(employee.id).padStart(3, "0")}
              </span>
            </div>

            <div className="imb-card-top-actions">
              <button
                type="button"
                className="imb-card-action-btn imb-card-action-flip"
                onClick={() => setIsFlipped(false)}
                aria-label={t("Flip to Front")}
              >
                <IconFlip />
                <span className="imb-card-action-label">
                  {t("Front Badge")}
                </span>
              </button>
            </div>
          </div>

          {/* Timeline Summary Banner */}
          <div className="imb-timeline-summary-banner">
            <div className="imb-timeline-summary-text">
              {t("Joined on")} <strong>{onboardDateStr}</strong> ·{" "}
              {t("Participated in")}{" "}
              <strong>{extra?.taskCount ?? 0} {t("tasks")}</strong> ·{" "}
              {t("Contributed")}{" "}
              <strong>{extra?.messageCount ?? 0} {t("messages")}</strong>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleDispatchTask()}
              disabled={summoning}
            >
              <IconPlus /> {t("New Task")}
            </Button>
          </div>

          {/* Timeline Scroll Area */}
          <div className="imb-timeline-scroll-pane">
            {extraLoading ? (
              <div className="imb-timeline-loading">{t("Loading history…")}</div>
            ) : !extra || extra.tasks.length === 0 ? (
              <div className="imb-timeline-empty">
                <div className="imb-empty-icon-wrap">
                  <IconClock />
                </div>
                <div className="imb-empty-title">
                  {t("No task records yet")}
                </div>
                <div className="imb-empty-desc">
                  {t(
                    "This employee hasn't joined any conversation yet. Click below to start the first task!",
                  )}
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void handleDispatchTask()}
                  disabled={summoning}
                >
                  <IconSendRocket /> {t("Dispatch First Task")}
                </Button>
              </div>
            ) : (
              <div className="imb-timeline-list">
                {extra.tasks.map((task) => (
                  <div key={task.chatId} className="imb-timeline-node">
                    <div className="imb-timeline-rail">
                      <div className="imb-timeline-dot" />
                      <div className="imb-timeline-line" />
                    </div>

                    <div
                      className="imb-timeline-card"
                      role="button"
                      tabIndex={0}
                      onClick={() => void appStore.focusChat(task.chatId)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          void appStore.focusChat(task.chatId);
                        }
                      }}
                    >
                      <div className="imb-timeline-card-head">
                        <span className="imb-timeline-chat-title">
                          {task.title}
                        </span>
                        <span className="imb-timeline-date">
                          {formatDateTimeStr(task.lastMessageAt)}
                        </span>
                      </div>

                      <div className="imb-timeline-card-foot">
                        <span className="imb-timeline-msg-badge">
                          {task.messageCount > 0
                            ? `${task.messageCount} ${t("replies")}`
                            : t("Participant")}
                        </span>
                        <span className="imb-timeline-link-hint">
                          {t("Open Chat")} →
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* TEARING / SHREDDING SPLIT OVERLAYS */}
        {isTearing && (
          <div className="imb-tear-overlay">
            <div className="imb-tear-half imb-tear-left" />
            <div className="imb-tear-half imb-tear-right" />
            <div className="imb-tear-line" />
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {!isAssistant && (
        <Modal
          open={removeOpen}
          onClose={() => setRemoveOpen(false)}
          title={t("Delete employee")}
          actions={
            <>
              <Button variant="secondary" onClick={() => setRemoveOpen(false)}>
                {t("Cancel")}
              </Button>
              <Button variant="danger" onClick={executeTearDelete}>
                {t("Shred & Delete")}
              </Button>
            </>
          }
        >
          <p className="imb-employee-delete-note">
            {t(
              "The employee's conversation records will also be cleared. This will shred the employee badge and cannot be undone.",
            )}
          </p>
        </Modal>
      )}

      <AvatarCropModal
        open={cropOpen}
        imageFile={cropFile}
        onClose={() => {
          setCropOpen(false);
          setCropFile(null);
        }}
        onConfirm={onCropConfirm}
      />
    </div>
  );
}
