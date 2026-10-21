import {
  THINKING_LEVEL_LABEL_KEYS,
  type ThinkingLevel,
} from "@shared/constants/thinking";
import { t } from "@shared/l10n";
import type {
  Employee,
  EmployeeInput,
  EmployeeProfileExtra,
  ModelOption,
} from "@shared/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { appStore } from "../../../../app-store";
import { modelRef, thinkingLevelsFor } from "../../../../thinking-options";
import { Button } from "../../../button";
import { employeeAvatarSrc } from "../../../employee-avatar/avatar-src";
import {
  IconCamera,
  IconChevronDown,
  IconClock,
  IconEdit,
  IconMcp,
  IconPlus,
  IconSkills,
  IconTrash,
} from "../../../icons";
import { Input } from "../../../input";
import { Modal } from "../../../modal";
import { MultiSelect, type MultiSelectOption } from "../../../multi-select";
import { SearchInput } from "../../../search-input";
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
  /** App default thinking level, inherited when this employee leaves it unset. */
  defaultThinking: string;
  onPatch: (input: EmployeeInput) => Promise<boolean>;
  onRemove: () => void;
  /** Called when the avatar file is replaced (keeps appStore in sync). */
  onAvatarUpdated?: (employee: Employee) => void;
}

const SAVE_DEBOUNCE_MS = 400;

export type MaterialTier = "paper" | "pvc" | "titanium" | "platinum";

function IconSendRocket(): React.JSX.Element {
  return (
    <svg
      width="13"
      height="13"
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
  defaultThinking,
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
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
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
  const [isTearing, setIsTearing] = useState(false);
  const [summoning, setSummoning] = useState(false);

  // Task history collapsible drawer state & filter
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");

  // Skill and MCP picker expansion states
  const [addSkillOpen, setAddSkillOpen] = useState(false);
  const [addMcpOpen, setAddMcpOpen] = useState(false);

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

  // In-place editing of the single name/role display: Enter or blur commits
  // through the same debounced `scheduleSave`, Escape cancels. An empty or
  // unchanged name is a silent no-op (house pattern); an empty role is allowed
  // and simply displays as "—".
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
    }
  };

  // Subtle silky spotlight sheen mouse tracking
  const handleWidgetMouseMove = (e: React.MouseEvent<HTMLDivElement>): void => {
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

  // Quick unequip handlers for directly listed skills and MCP tools
  const removeSkill = (skillName: string): void => {
    const next = (form.skills ?? []).filter((s) => s !== skillName);
    scheduleSave({ ...form, skills: next });
  };

  const removeMcp = (mcpName: string): void => {
    const next = (form.mcp ?? []).filter((m) => m !== mcpName);
    scheduleSave({ ...form, mcp: next });
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

  // Card Material Tier Calculation based on completed tasks
  const materialTier: MaterialTier = useMemo(() => {
    const count = extra?.taskCount ?? 0;
    if (count >= 50) return "platinum";
    if (count >= 20) return "titanium";
    if (count >= 5) return "pvc";
    return "paper";
  }, [extra?.taskCount]);

  const materialTierMeta = useMemo(() => {
    switch (materialTier) {
      case "platinum":
        return {
          label: "👑 午夜曜石 · 首席",
          tierName: "Midnight Obsidian",
          badgeStyle: "imb-tier-chip-platinum",
        };
      case "titanium":
        return {
          label: "🛡️ 喷砂钛金 · 资深",
          tierName: "Bead-blasted Titanium",
          badgeStyle: "imb-tier-chip-titanium",
        };
      case "pvc":
        return {
          label: "💳 雾面透光 · 进阶",
          tierName: "Frosted PVC",
          badgeStyle: "imb-tier-chip-pvc",
        };
      default:
        return {
          label: "📜 原浆质感 · 新锐",
          tierName: "Kraft Alabaster",
          badgeStyle: "imb-tier-chip-paper",
        };
    }
  }, [materialTier]);

  // Thinking level adaptive slider steps for currently selected model
  const availableThinkingLevels = useMemo(() => {
    return thinkingLevelsFor(models, form.modelId ?? "", defaultModel);
  }, [models, form.modelId, defaultModel]);

  const thinkingSliderSteps = useMemo(() => {
    return [
      { level: null as ThinkingLevel | null, label: t("Default") },
      ...availableThinkingLevels.map((lvl) => ({
        level: lvl,
        label: t(THINKING_LEVEL_LABEL_KEYS[lvl]),
      })),
    ];
  }, [availableThinkingLevels]);

  const currentSliderIdx = useMemo(() => {
    if (form.thinkingLevel === null) return 0;
    const idx = thinkingSliderSteps.findIndex(
      (s) => s.level === form.thinkingLevel,
    );
    return idx >= 0 ? idx : 0;
  }, [form.thinkingLevel, thinkingSliderSteps]);

  const handleSliderChange = (newIdx: number): void => {
    const target = thinkingSliderSteps[newIdx];
    if (target) {
      scheduleSave({ ...form, thinkingLevel: target.level });
    }
  };

  // Filtered tasks in history drawer
  const filteredTasks = useMemo(() => {
    if (!extra?.tasks) return [];
    const q = historyQuery.trim().toLowerCase();
    if (!q) return extra.tasks;
    return extra.tasks.filter((task) =>
      task.title.toLowerCase().includes(q),
    );
  }, [extra?.tasks, historyQuery]);

  return (
    <div className="imb-employee-detail-viewport">
      {/* ====================================================================
          TOP EXECUTIVE WIDGET: Compact ID Badge Card
          ==================================================================== */}
      <div
        className={`imb-employee-widget imb-tier-${materialTier} ${isTearing ? "is-tearing" : ""}`}
        onMouseMove={handleWidgetMouseMove}
      >
        <div className="imb-widget-sheen" />

        {/* Lanyard slot */}
        <div className="imb-widget-lanyard-slot" />

        {/* Top bar inside widget */}
        <div className="imb-widget-top-bar">
          <div className="imb-widget-chip-group">
            <span className="imb-widget-chip-graphic" />
            <span className="imb-widget-id-code">
              {isAssistant
                ? "EXEC-CDO #000"
                : `ID-BADGE #${String(employee.id).padStart(3, "0")}`}
            </span>
            <span className={`imb-widget-tier-badge ${materialTierMeta.badgeStyle}`}>
              {materialTierMeta.label}
            </span>
          </div>

          <div className="imb-widget-actions">
            <Tooltip content={t("Dispatch Task")}>
              <button
                type="button"
                className="imb-widget-btn imb-widget-btn-summon"
                onClick={() => void handleDispatchTask()}
                disabled={summoning}
                aria-label={t("Dispatch Task")}
              >
                <IconSendRocket />
                <span>{t("Dispatch")}</span>
              </button>
            </Tooltip>

            {!isAssistant && (
              <Tooltip content={t("Retire/Shred Card")}>
                <button
                  type="button"
                  className="imb-widget-btn imb-widget-btn-danger"
                  onClick={() => setRemoveOpen(true)}
                  aria-label={t("Delete")}
                >
                  <IconTrash />
                </button>
              </Tooltip>
            )}
          </div>
        </div>

        {/* Hero Identity: Avatar, Name, Role, Tenure */}
        <div className="imb-widget-hero">
          <div
            className="imb-widget-avatar-wrap"
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
                className="imb-widget-avatar-img"
                src={displayAvatarUrl}
                alt={displayName}
              />
            ) : (
              <div className="imb-widget-avatar-placeholder">
                {displayName.slice(0, 1).toUpperCase() || "?"}
              </div>
            )}
            <div className="imb-widget-avatar-overlay">
              <IconCamera />
            </div>
            <div
              className={`imb-widget-status-dot ${employee.disabled ? "is-disabled" : "is-active"}`}
              title={employee.disabled ? t("Disabled") : t("Active")}
            />
          </div>

          <div className="imb-widget-hero-meta">
            <div className="imb-widget-name-row">
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

              <div className="imb-widget-status-pill">
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

            <div className="imb-widget-role-row">
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

            <div className="imb-widget-tenure-strip">
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

        {/* 4 Pure Accomplishment Performance Metrics */}
        <div className="imb-widget-hud-bar">
          <div className="imb-hud-stat">
            <span className="imb-hud-label">{t("Tasks Completed")}</span>
            <span className="imb-hud-val">
              {extra?.taskCount ?? 0}
              <span className="imb-hud-unit">{t("sessions")}</span>
            </span>
          </div>
          <div className="imb-hud-divider" />
          <div className="imb-hud-stat">
            <span className="imb-hud-label">{t("Messages Sent")}</span>
            <span className="imb-hud-val">
              {extra?.messageCount ?? 0}
              <span className="imb-hud-unit">{t("replies")}</span>
            </span>
          </div>
          <div className="imb-hud-divider" />
          <div className="imb-hud-stat">
            <span className="imb-hud-label">{t("Equipped Skills")}</span>
            <span className="imb-hud-val">
              {form.skills?.length ?? 0}
              <span className="imb-hud-unit">{t("skills")}</span>
            </span>
          </div>
          <div className="imb-hud-divider" />
          <div className="imb-hud-stat">
            <span className="imb-hud-label">{t("Total Tenure")}</span>
            <span className="imb-hud-val imb-hud-val-accent">{tenureStr}</span>
          </div>
        </div>

        {/* Tearing Overlay for Shred Effect */}
        {isTearing && (
          <div className="imb-tear-overlay">
            <div className="imb-tear-half imb-tear-left" />
            <div className="imb-tear-half imb-tear-right" />
            <div className="imb-tear-line" />
          </div>
        )}
      </div>

      {/* ====================================================================
          NATURAL DETAIL FLOW SECTIONS (Below Widget)
          ==================================================================== */}
      <div className="imb-employee-flow-sections">
        {/* 1. Persona & Directives Section */}
        <div className="imb-flow-section">
          <div className="imb-flow-section-head">
            <span className="imb-flow-title">{t("Persona & Directives")}</span>
            {isAssistant && (
              <span className="imb-flow-sub">
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
            minHeight={140}
            onChange={(e) =>
              setForm({ ...form, systemPrompt: e.target.value })
            }
            onValueCommit={(systemPrompt) =>
              scheduleSave({ ...form, systemPrompt })
            }
          />
        </div>

        {/* 2. Unified Compute & Thinking Level Slider Bento */}
        <div className="imb-flow-section imb-compute-card">
          <div className="imb-flow-section-head">
            <span className="imb-flow-title">
              🧠 {t("Compute & Intelligence Specifications")}
            </span>
          </div>

          <div className="imb-compute-grid">
            {/* Model Select */}
            <div className="imb-compute-col">
              <label
                htmlFor={`emp-model-${employee.id}`}
                className="imb-compute-label"
              >
                {t("Model")}
              </label>
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

            {/* Thinking Level Adaptive Slider */}
            <div className="imb-compute-col">
              <div className="imb-compute-label-row">
                <span className="imb-compute-label">
                  {t("Thinking Level")}
                </span>
                <span className="imb-thinking-level-badge">
                  {thinkingSliderSteps[currentSliderIdx]?.label ?? t("Default")}
                </span>
              </div>

              {/* Slider Track with Notch Markers */}
              <div className="imb-thinking-slider-wrap">
                <input
                  type="range"
                  className="imb-thinking-range-input"
                  min="0"
                  max={Math.max(0, thinkingSliderSteps.length - 1)}
                  step="1"
                  value={currentSliderIdx}
                  onChange={(e) => handleSliderChange(Number(e.target.value))}
                  aria-label={t("Thinking Level")}
                />

                <div className="imb-thinking-ticks-track">
                  {thinkingSliderSteps.map((step, idx) => (
                    <button
                      key={step.label}
                      type="button"
                      className={`imb-thinking-tick-btn ${idx === currentSliderIdx ? "is-active" : ""}`}
                      onClick={() => handleSliderChange(idx)}
                      title={step.label}
                    >
                      <span className="imb-tick-dot" />
                      <span className="imb-tick-label">{step.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 3. Directly Listed Equipped Skills Shelf */}
        <div className="imb-flow-section imb-skills-shelf">
          <div className="imb-shelf-head">
            <span className="imb-flow-title">
              <IconSkills className="imb-shelf-icon" />
              {t("Equipped Skills")} ({form.skills?.length ?? 0})
            </span>
            <button
              type="button"
              className="imb-shelf-manage-btn"
              onClick={() => setAddSkillOpen((v) => !v)}
            >
              <IconPlus className="imb-sm" />
              {addSkillOpen ? t("Close") : t("Manage Skills")}
            </button>
          </div>

          <div className="imb-shelf-pills-list">
            {!form.skills || form.skills.length === 0 ? (
              <span className="imb-shelf-empty-hint">
                {t("No skills equipped. Click Manage Skills to add.")}
              </span>
            ) : (
              form.skills.map((skill) => (
                <span key={skill} className="imb-skill-pill">
                  <span className="imb-skill-pill-text">{skill}</span>
                  <button
                    type="button"
                    className="imb-skill-pill-remove"
                    aria-label={`Remove ${skill}`}
                    title={t("Unequip")}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeSkill(skill);
                    }}
                  >
                    ×
                  </button>
                </span>
              ))
            )}
          </div>

          {addSkillOpen && (
            <div className="imb-shelf-dropdown-wrap">
              <MultiSelect
                value={form.skills ?? []}
                options={skillOptions}
                placeholder={t("Select skills")}
                emptyHint={t("No skills installed")}
                onChange={(skills) => scheduleSave({ ...form, skills })}
              />
            </div>
          )}
        </div>

        {/* 4. Directly Listed Linked MCP Tools Shelf */}
        {!isAssistant && (
          <div className="imb-flow-section imb-skills-shelf">
            <div className="imb-shelf-head">
              <span className="imb-flow-title">
                <IconMcp className="imb-shelf-icon" />
                {t("Linked MCP Tools")} ({form.mcp?.length ?? 0})
              </span>
              <button
                type="button"
                className="imb-shelf-manage-btn"
                onClick={() => setAddMcpOpen((v) => !v)}
              >
                <IconPlus className="imb-sm" />
                {addMcpOpen ? t("Close") : t("Manage MCP")}
              </button>
            </div>

            <div className="imb-shelf-pills-list">
              {!form.mcp || form.mcp.length === 0 ? (
                <span className="imb-shelf-empty-hint">
                  {t("No MCP tools connected. Click Manage MCP to link.")}
                </span>
              ) : (
                form.mcp.map((mcp) => (
                  <span key={mcp} className="imb-skill-pill imb-mcp-pill">
                    <span className="imb-skill-pill-text">{mcp}</span>
                    <button
                      type="button"
                      className="imb-skill-pill-remove"
                      aria-label={`Remove ${mcp}`}
                      title={t("Unlink")}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeMcp(mcp);
                      }}
                    >
                      ×
                    </button>
                  </span>
                ))
              )}
            </div>

            {addMcpOpen && (
              <div className="imb-shelf-dropdown-wrap">
                <MultiSelect
                  value={form.mcp ?? []}
                  options={mcpOptions}
                  placeholder={t("Select MCP")}
                  emptyHint={t("No MCP configured")}
                  onChange={(mcp) => scheduleSave({ ...form, mcp })}
                />
              </div>
            )}
          </div>
        )}

        {/* 5. Collapsible Task History Drawer */}
        <div className="imb-flow-section imb-history-drawer">
          <div
            className="imb-history-drawer-head"
            role="button"
            tabIndex={0}
            onClick={() => setHistoryOpen((v) => !v)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setHistoryOpen((v) => !v);
              }
            }}
          >
            <div className="imb-history-head-left">
              <span className="imb-flow-title">
                📜 {t("Career Task History")}
              </span>
              <span className="imb-history-count-badge">
                {extra?.taskCount ?? 0} {t("tasks")}
              </span>
            </div>

            <div className="imb-history-head-right">
              <span className="imb-history-summary-quiet">
                {t("Contributed")} {extra?.messageCount ?? 0} {t("messages")}
              </span>
              <span
                className={`imb-drawer-chevron ${historyOpen ? "is-open" : ""}`}
              >
                <IconChevronDown />
              </span>
            </div>
          </div>

          {/* Collapsible Drawer Content */}
          {historyOpen && (
            <div className="imb-history-drawer-body">
              {/* Filter Search Input */}
              {extra && extra.tasks.length > 5 && (
                <div className="imb-history-search-bar">
                  <SearchInput
                    value={historyQuery}
                    onValueChange={setHistoryQuery}
                    placeholder={t("Filter task titles…")}
                  />
                </div>
              )}

              {extraLoading ? (
                <div className="imb-history-loading">{t("Loading history…")}</div>
              ) : filteredTasks.length === 0 ? (
                <div className="imb-history-empty">
                  <div className="imb-history-empty-icon">
                    <IconClock />
                  </div>
                  <div className="imb-history-empty-text">
                    {historyQuery
                      ? t("No tasks matched your filter.")
                      : t("No task records found for this employee yet.")}
                  </div>
                  {!historyQuery && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void handleDispatchTask()}
                      disabled={summoning}
                    >
                      <IconSendRocket /> {t("Dispatch First Task")}
                    </Button>
                  )}
                </div>
              ) : (
                <div className="imb-history-timeline">
                  {filteredTasks.map((task) => (
                    <div key={task.chatId} className="imb-history-item">
                      <div className="imb-history-rail">
                        <div className="imb-history-dot" />
                        <div className="imb-history-line" />
                      </div>

                      <div
                        className="imb-history-card"
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
                        <div className="imb-history-card-head">
                          <span className="imb-history-chat-title">
                            {task.title}
                          </span>
                          <span className="imb-history-date">
                            {formatDateTimeStr(task.lastMessageAt)}
                          </span>
                        </div>

                        <div className="imb-history-card-foot">
                          <span className="imb-history-msg-badge">
                            {task.messageCount > 0
                              ? `${task.messageCount} ${t("replies")}`
                              : t("Participant")}
                          </span>
                          <span className="imb-history-jump-hint">
                            {t("Open Chat")} →
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}
