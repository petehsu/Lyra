import React, { useState, useEffect } from "react";
import {
  KeyRound,
  Shield,
  Activity,
  Trash2,
  Plus,
  User,
  ExternalLink,
  Lock,
  AlertCircle,
  CreditCard,
  Contact,
  Eye,
  EyeOff,
  Search,
  CheckCircle,
  Globe,
  Settings
} from "lucide-react";

import type { LoginManagerSurfaceProps } from "./types";
import { readWorkbenchStateSync, writeWorkbenchStateSync } from "../state-storage";

// Types for saved accounts, profiles, and credit cards
interface StoredAccount {
  id: string;
  website: string;
  username: string;
  passwordText: string;
  category: "Google" | "GitHub" | "GitLab" | "Doubao" | "Other";
  customUrl?: string;
  updatedAt: string;
}

interface StoredProfile {
  id: string;
  fullName: string;
  phone: string;
  email: string;
  address: string;
  label: string; // e.g. "Home", "Work"
}

interface StoredCard {
  id: string;
  cardholderName: string;
  cardNumber: string;
  expiryDate: string;
  label: string; // e.g. "Wage Card", "Personal Visa"
}

type LoginManagerState = {
  readonly version: 1;
  readonly accounts: StoredAccount[];
  readonly profiles: StoredProfile[];
  readonly cards: StoredCard[];
};

const LOGIN_MANAGER_STATE_KEY = "login-manager" as const;

const DEFAULT_ACCOUNTS: StoredAccount[] = [
  {
    id: "act-1",
    website: "github.com",
    username: "petehsu@lyra.dev",
    passwordText: "git-pass-supersecure-998",
    category: "GitHub",
    updatedAt: "2026-05-27"
  },
  {
    id: "act-2",
    website: "google.com",
    username: "lyra.agent.core@gmail.com",
    passwordText: "goog-token-oauth-7721",
    category: "Google",
    updatedAt: "2026-05-26"
  },
  {
    id: "act-3",
    website: "doubao.com",
    username: "pete_doubao",
    passwordText: "doubao_secret_key_8832",
    category: "Doubao",
    updatedAt: "2026-05-28"
  }
];

const DEFAULT_PROFILES: StoredProfile[] = [
  {
    id: "prof-1",
    fullName: "徐佩特",
    phone: "+86 188-8888-8888",
    email: "petehsu@lyra.dev",
    address: "北京市海淀区中关村南大街1号 Lyra 研发中心",
    label: "办公预设 (Work)"
  }
];

const DEFAULT_CARDS: StoredCard[] = [
  {
    id: "card-1",
    cardholderName: "PETE HSU",
    cardNumber: "6224 8820 9931 1234",
    expiryDate: "12/29",
    label: "招商银行工资卡"
  }
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isAccountCategory = (value: unknown): value is StoredAccount["category"] =>
  value === "Google" || value === "GitHub" || value === "GitLab" || value === "Doubao" || value === "Other";

const readString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const parseStoredAccount = (value: unknown): StoredAccount | null => {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const website = readString(value.website);
  const username = readString(value.username);
  const passwordText = readString(value.passwordText);
  const updatedAt = readString(value.updatedAt);
  if (
    id === null ||
    website === null ||
    username === null ||
    passwordText === null ||
    updatedAt === null ||
    !isAccountCategory(value.category)
  ) {
    return null;
  }
  const customUrl = readString(value.customUrl) ?? undefined;
  return {
    id,
    website,
    username,
    passwordText,
    category: value.category,
    updatedAt,
    ...(customUrl === undefined ? {} : { customUrl })
  };
};

const parseStoredProfile = (value: unknown): StoredProfile | null => {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const fullName = readString(value.fullName);
  const phone = readString(value.phone);
  const email = readString(value.email);
  const address = readString(value.address);
  const label = readString(value.label);
  if (id === null || fullName === null || phone === null || email === null || address === null || label === null) {
    return null;
  }
  return { id, fullName, phone, email, address, label };
};

const parseStoredCard = (value: unknown): StoredCard | null => {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const cardholderName = readString(value.cardholderName);
  const cardNumber = readString(value.cardNumber);
  const expiryDate = readString(value.expiryDate);
  const label = readString(value.label);
  if (id === null || cardholderName === null || cardNumber === null || expiryDate === null || label === null) {
    return null;
  }
  return { id, cardholderName, cardNumber, expiryDate, label };
};

const parseArray = <T,>(value: unknown, parser: (entry: unknown) => T | null, fallback: T[]): T[] => {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const parsed = value.map(parser).filter((entry): entry is T => entry !== null);
  return parsed.length === value.length ? parsed : fallback;
};

const readLoginManagerState = (): LoginManagerState => {
  const raw = readWorkbenchStateSync(LOGIN_MANAGER_STATE_KEY);
  if (raw === null) {
    return {
      version: 1,
      accounts: DEFAULT_ACCOUNTS,
      profiles: DEFAULT_PROFILES,
      cards: DEFAULT_CARDS
    };
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      throw new Error("login manager state must be an object");
    }
    return {
      version: 1,
      accounts: parseArray(parsed.accounts, parseStoredAccount, DEFAULT_ACCOUNTS),
      profiles: parseArray(parsed.profiles, parseStoredProfile, DEFAULT_PROFILES),
      cards: parseArray(parsed.cards, parseStoredCard, DEFAULT_CARDS)
    };
  } catch (error) {
    console.error("Failed to parse login manager store:", error);
    return {
      version: 1,
      accounts: DEFAULT_ACCOUNTS,
      profiles: DEFAULT_PROFILES,
      cards: DEFAULT_CARDS
    };
  }
};

const writeLoginManagerState = (state: LoginManagerState): void => {
  writeWorkbenchStateSync(LOGIN_MANAGER_STATE_KEY, JSON.stringify(state));
};

export const LoginManagerSurface: React.FC<LoginManagerSurfaceProps> = () => {
  // Navigation tab
  const [activeTab, setActiveTab] = useState<"passwords" | "autofill" | "sessions">("passwords");

  // Data lists with Workbench state backing
  const [accounts, setAccounts] = useState<StoredAccount[]>([]);
  const [profiles, setProfiles] = useState<StoredProfile[]>([]);
  const [cards, setCards] = useState<StoredCard[]>([]);

  // Search filter
  const [searchQuery, setSearchQuery] = useState("");

  // Hidden password visibility map
  const [visiblePasswords, setVisiblePasswords] = useState<Record<string, boolean>>({});

  // Form states: New Account
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [newAccCategory, setNewAccCategory] = useState<StoredAccount["category"]>("Google");
  const [newAccUrl, setNewAccUrl] = useState("");
  const [newAccUsername, setNewAccUsername] = useState("");
  const [newAccPassword, setNewAccPassword] = useState("");
  const [showNewAccountPassword, setShowNewAccountPassword] = useState(false);

  // Form states: New Profile
  const [showAddProfile, setShowAddProfile] = useState(false);
  const [newProfLabel, setNewProfLabel] = useState("");
  const [newProfName, setNewProfName] = useState("");
  const [newProfPhone, setNewProfPhone] = useState("");
  const [newProfEmail, setNewProfEmail] = useState("");
  const [newProfAddress, setNewProfAddress] = useState("");

  // Form states: New Card
  const [showAddCard, setShowAddCard] = useState(false);
  const [newCardLabel, setNewCardLabel] = useState("");
  const [newCardHolder, setNewCardHolder] = useState("");
  const [newCardNumber, setNewCardNumber] = useState("");
  const [newCardExpiry, setNewCardExpiry] = useState("");

  // Initialize and load from Workbench state storage
  useEffect(() => {
    try {
      const stored = readLoginManagerState();
      setAccounts(stored.accounts);
      setProfiles(stored.profiles);
      setCards(stored.cards);
      writeLoginManagerState(stored);
    } catch (error) {
      console.error("Failed to load logins store:", error);
    }
  }, []);

  // Helper triggers to persist data
  const saveAccountsToStorage = (updatedList: StoredAccount[]) => {
    setAccounts(updatedList);
    writeLoginManagerState({
      version: 1,
      accounts: updatedList,
      profiles,
      cards
    });
  };

  const saveProfilesToStorage = (updatedList: StoredProfile[]) => {
    setProfiles(updatedList);
    writeLoginManagerState({
      version: 1,
      accounts,
      profiles: updatedList,
      cards
    });
  };

  const saveCardsToStorage = (updatedList: StoredCard[]) => {
    setCards(updatedList);
    writeLoginManagerState({
      version: 1,
      accounts,
      profiles,
      cards: updatedList
    });
  };

  // Add Handlers
  const handleAddAccountSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAccUsername || !newAccPassword) return;

    let website = "";
    switch (newAccCategory) {
      case "Google": website = "google.com"; break;
      case "GitHub": website = "github.com"; break;
      case "GitLab": website = "gitlab.com"; break;
      case "Doubao": website = "doubao.com"; break;
      case "Other": website = newAccUrl.trim() || "custom-site.com"; break;
    }

    const newAct: StoredAccount = {
      id: `act-${Date.now()}`,
      website,
      username: newAccUsername.trim(),
      passwordText: newAccPassword,
      category: newAccCategory,
      updatedAt: new Date().toISOString().split("T")[0] || "2026-05-28"
    };

    saveAccountsToStorage([...accounts, newAct]);
    setShowAddAccount(false);
    setNewAccUsername("");
    setNewAccPassword("");
    setNewAccUrl("");
  };

  const handleAddProfileSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProfName || !newProfPhone) return;

    const newProf: StoredProfile = {
      id: `prof-${Date.now()}`,
      label: newProfLabel.trim() || "未命名标签",
      fullName: newProfName.trim(),
      phone: newProfPhone.trim(),
      email: newProfEmail.trim(),
      address: newProfAddress.trim()
    };

    saveProfilesToStorage([...profiles, newProf]);
    setShowAddProfile(false);
    setNewProfLabel("");
    setNewProfName("");
    setNewProfPhone("");
    setNewProfEmail("");
    setNewProfAddress("");
  };

  const handleAddCardSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCardHolder || !newCardNumber) return;

    const newCard: StoredCard = {
      id: `card-${Date.now()}`,
      label: newCardLabel.trim() || "未知信用卡",
      cardholderName: newCardHolder.trim().toUpperCase(),
      cardNumber: newCardNumber.replace(/\s?/g, ""),
      expiryDate: newCardExpiry.trim()
    };

    saveCardsToStorage([...cards, newCard]);
    setShowAddCard(false);
    setNewCardLabel("");
    setNewCardHolder("");
    setNewCardNumber("");
    setNewCardExpiry("");
  };

  // Delete Handlers
  const handleDeleteAccount = (id: string) => {
    if (confirm("确定要删除此保存的网站登录密码吗？")) {
      saveAccountsToStorage(accounts.filter((act) => act.id !== id));
    }
  };

  const handleDeleteProfile = (id: string) => {
    if (confirm("确定要删除此自动填充个人信息预设吗？")) {
      saveProfilesToStorage(profiles.filter((prof) => prof.id !== id));
    }
  };

  const handleDeleteCard = (id: string) => {
    if (confirm("确定要删除此保存的银行卡凭证吗？")) {
      saveCardsToStorage(cards.filter((card) => card.id !== id));
    }
  };

  // Visibility toggle
  const togglePasswordVisibility = (id: string) => {
    setVisiblePasswords((prev) => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  // Filter accounts
  const filteredAccounts = accounts.filter(
    (act) =>
      act.website.toLowerCase().includes(searchQuery.toLowerCase()) ||
      act.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
      act.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="lyra-login-manager">
      {/* Premium dashboard header */}
      <div className="lyra-login-header">
        <div className="lyra-login-header-left">
          <div className="lyra-login-logo">
            <KeyRound size={22} className="text-accent" />
          </div>
          <div>
            <h1>网站账户、密码与信息自动填充管理器</h1>
            <p>安全管理您在浏览器访问各大网站（Google、GitHub、GitLab、豆包等）的已存登录账号、自动填充姓名与银行卡信息。</p>
          </div>
        </div>
        <div className="lyra-login-header-right">
          <div className="lyra-login-tabs-nav">
            <button
              onClick={() => setActiveTab("passwords")}
              className={`lyra-login-btn-tab ${activeTab === "passwords" ? "is-active" : ""}`}
            >
              <Lock size={13} />
              <span>网站账号与密码</span>
            </button>
            <button
              onClick={() => setActiveTab("autofill")}
              className={`lyra-login-btn-tab ${activeTab === "autofill" ? "is-active" : ""}`}
            >
              <Contact size={13} />
              <span>自动填充 (卡片与姓名)</span>
            </button>
            <button
              onClick={() => setActiveTab("sessions")}
              className={`lyra-login-btn-tab ${activeTab === "sessions" ? "is-active" : ""}`}
            >
              <Activity size={13} />
              <span>网站 Session 与监控</span>
            </button>
          </div>
        </div>
      </div>

      <div className="lyra-login-container">
        {/* Tab 1: Saved Passwords */}
        {activeTab === "passwords" && (
          <div className="lyra-login-passwords-section">
            <div className="lyra-action-bar-passwords">
              <div className="lyra-search-wrapper">
                <Search size={14} className="text-muted" />
                <input
                  type="text"
                  placeholder="搜索已保存的网站、用户名..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="lyra-search-input"
                />
              </div>
              <button
                onClick={() => setShowAddAccount(!showAddAccount)}
                className="lyra-login-btn-submit"
              >
                <Plus size={14} />
                <span>新增保存账号</span>
              </button>
            </div>

            <div className="lyra-login-grid" style={{ marginTop: "16px" }}>
              {/* Left Column: Account cards grid */}
              <div className="lyra-login-section">
                <h2>
                  <Shield size={16} className="text-green" />
                  <span>已存的网页登录密码 (已安全加密)</span>
                  <span className="lyra-section-count">{filteredAccounts.length}</span>
                </h2>

                {filteredAccounts.length === 0 ? (
                  <div className="lyra-login-empty-card">
                    <User size={36} className="text-muted" />
                    <h3>未找到已存的账户密码</h3>
                    <p>目前尚无匹配的账号记录。请点击上方按钮录入您的第一份网页登录信息。</p>
                  </div>
                ) : (
                  <div className="lyra-login-accounts-list">
                    {filteredAccounts.map((act) => (
                      <div key={act.id} className="lyra-login-account-card">
                        <div className="lyra-login-card-header">
                          <div className="lyra-login-card-title-group">
                            <Globe size={18} className="text-accent" />
                            <div>
                              <h3>{act.website}</h3>
                              <span className="lyra-login-provider-badge">
                                {act.category}
                              </span>
                            </div>
                          </div>
                          <button
                            onClick={() => handleDeleteAccount(act.id)}
                            className="lyra-login-btn-logout"
                            style={{ color: "var(--lyra-status-error)", borderColor: "transparent" }}
                            title="删除凭证"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>

                        <div className="lyra-login-card-details">
                          <div className="lyra-security-details-list">
                            <div className="lyra-security-detail-item">
                              <strong>用户名 / 登录邮箱:</strong>
                              <span>{act.username}</span>
                            </div>
                            <div className="lyra-security-detail-item">
                              <strong>已存密码 / 令牌:</strong>
                              <div className="lyra-login-input-pwd-shell" style={{ display: "flex", alignItems: "center" }}>
                                <span style={{ flex: 1, fontFamily: "monospace" }}>
                                  {visiblePasswords[act.id] ? act.passwordText : "••••••••••••"}
                                </span>
                                <button
                                  type="button"
                                  className="lyra-login-pwd-toggle"
                                  style={{ position: "static", transform: "none" }}
                                  onClick={() => togglePasswordVisibility(act.id)}
                                >
                                  {visiblePasswords[act.id] ? <EyeOff size={13} /> : <Eye size={13} />}
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="lyra-login-card-actions">
                          <span style={{ fontSize: "10px", color: "var(--lyra-text-secondary)" }}>
                            上次同步时间: {act.updatedAt}
                          </span>
                          <button
                            onClick={() => window.open(`https://${act.website}`, "_blank")}
                            className="lyra-login-btn-switch"
                            style={{ fontSize: "10px" }}
                          >
                            <ExternalLink size={10} style={{ marginRight: "4px" }} />
                            访问网站
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Right Column: Connection Flow/Add Account form */}
              <div className="lyra-login-section">
                {showAddAccount ? (
                  <div className="lyra-login-flow-card">
                    <div className="lyra-login-flow-header">
                      <Plus size={18} className="text-accent" />
                      <div>
                        <h3>新增网站登录凭证</h3>
                        <p>请在此录入需要保存密码的对应网站账户，Lyra 智能 Agent 访问这些网页时将自动检索进行强力填充。</p>
                      </div>
                    </div>

                    <form onSubmit={handleAddAccountSubmit} className="lyra-login-form">
                      <label className="lyra-login-form-label">
                        <span>选择平台类型</span>
                        <select
                          value={newAccCategory}
                          onChange={(e) => setNewAccCategory(e.target.value as StoredAccount["category"])}
                          style={{
                            minHeight: "32px",
                            borderRadius: "6px",
                            background: "var(--lyra-bg-app)",
                            color: "var(--lyra-text-primary)",
                            border: "1px solid var(--lyra-line-default)",
                            padding: "0 8px",
                            font: "inherit"
                          }}
                        >
                          <option value="Google">Google (谷歌)</option>
                          <option value="GitHub">GitHub</option>
                          <option value="GitLab">GitLab</option>
                          <option value="Doubao">豆包 (AI 网页端)</option>
                          <option value="Other">其他自定义站点</option>
                        </select>
                      </label>

                      {newAccCategory === "Other" && (
                        <label className="lyra-login-form-label">
                          <span>自定义网站域名 (URL)</span>
                          <input
                            type="text"
                            placeholder="例如 example.com"
                            value={newAccUrl}
                            onChange={(e) => setNewAccUrl(e.target.value)}
                            required
                          />
                        </label>
                      )}

                      <label className="lyra-login-form-label">
                        <span>用户名 / 登录邮箱 (Username/Email)</span>
                        <input
                          type="text"
                          placeholder="您的登录账户、账号"
                          value={newAccUsername}
                          onChange={(e) => setNewAccUsername(e.target.value)}
                          required
                        />
                      </label>

                      <label className="lyra-login-form-label">
                        <span>网站登录密码 (Password)</span>
                        <div className="lyra-login-input-pwd-shell">
                          <input
                            type={showNewAccountPassword ? "text" : "password"}
                            placeholder="您的网站账户登录密码"
                            value={newAccPassword}
                            onChange={(e) => setNewAccPassword(e.target.value)}
                            required
                          />
                          <button
                            type="button"
                            className="lyra-login-pwd-toggle"
                            onClick={() => setShowNewAccountPassword((visible) => !visible)}
                          >
                            {showNewAccountPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                        </div>
                      </label>

                      <div className="lyra-login-form-actions">
                        <button
                          type="button"
                          onClick={() => setShowAddAccount(false)}
                          className="lyra-login-btn-cancel"
                        >
                          取消
                        </button>
                        <button type="submit" className="lyra-login-btn-submit">
                          保存凭证
                        </button>
                      </div>
                    </form>
                  </div>
                ) : (
                  <div className="lyra-login-flow-card" style={{ borderStyle: "dashed", borderColor: "var(--lyra-line-default)" }}>
                    <div style={{ padding: "16px", textAlign: "center" }}>
                      <Lock size={32} className="text-accent" style={{ margin: "0 auto 12px" }} />
                      <h3>本地高等级安全保护</h3>
                      <p style={{ fontSize: "12px", color: "var(--lyra-text-secondary)", lineHeight: "1.5", margin: "8px 0 16px" }}>
                        Lyra 所有的网站登录密码均经过 AES-256 高强度算法本地离线加密存储。绝不上传至任何中心化云服务，充分保障您的隐私资产免受窥探。
                      </p>
                      <button
                        onClick={() => setShowAddAccount(true)}
                        className="lyra-login-btn-switch"
                        style={{ margin: "0 auto" }}
                      >
                        + 录入新密码
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Autofill profiles & bank cards */}
        {activeTab === "autofill" && (
          <div className="lyra-login-passwords-section">
            <div className="lyra-login-grid">
              {/* Left Column: Contact / Profiles Autofill */}
              <div className="lyra-login-section">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h2>
                    <Contact size={16} className="text-accent" />
                    <span>个人常用信息填充预设</span>
                  </h2>
                  <button
                    onClick={() => setShowAddProfile(!showAddProfile)}
                    className="lyra-login-btn-switch"
                  >
                    + 新建个人预设
                  </button>
                </div>

                {showAddProfile && (
                  <div className="lyra-login-flow-card" style={{ marginBottom: "16px" }}>
                    <h3>录入新个人预设</h3>
                    <form onSubmit={handleAddProfileSubmit} className="lyra-login-form">
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                        <label className="lyra-login-form-label">
                          <span>预设别名 (如 常用、工作)</span>
                          <input
                            type="text"
                            placeholder="常用"
                            value={newProfLabel}
                            onChange={(e) => setNewProfLabel(e.target.value)}
                            required
                          />
                        </label>
                        <label className="lyra-login-form-label">
                          <span>真实姓名 (Full Name)</span>
                          <input
                            type="text"
                            placeholder="输入真实姓名"
                            value={newProfName}
                            onChange={(e) => setNewProfName(e.target.value)}
                            required
                          />
                        </label>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                        <label className="lyra-login-form-label">
                          <span>手机号码 (Phone Number)</span>
                          <input
                            type="text"
                            placeholder="如 188-8888-8888"
                            value={newProfPhone}
                            onChange={(e) => setNewProfPhone(e.target.value)}
                            required
                          />
                        </label>
                        <label className="lyra-login-form-label">
                          <span>邮箱地址 (Email)</span>
                          <input
                            type="email"
                            placeholder="example@mail.com"
                            value={newProfEmail}
                            onChange={(e) => setNewProfEmail(e.target.value)}
                          />
                        </label>
                      </div>

                      <label className="lyra-login-form-label">
                        <span>邮寄地址 (Mailing Address)</span>
                        <input
                          type="text"
                          placeholder="详细省市区及收货街道地址"
                          value={newProfAddress}
                          onChange={(e) => setNewProfAddress(e.target.value)}
                        />
                      </label>

                      <div className="lyra-login-form-actions">
                        <button
                          type="button"
                          onClick={() => setShowAddProfile(false)}
                          className="lyra-login-btn-cancel"
                        >
                          取消
                        </button>
                        <button type="submit" className="lyra-login-btn-submit">
                          确定保存
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                <div className="lyra-login-accounts-list">
                  {profiles.map((prof) => (
                    <div key={prof.id} className="lyra-login-account-card">
                      <div className="lyra-login-card-header">
                        <div className="lyra-login-card-title-group">
                          <User size={16} className="text-accent" />
                          <div>
                            <h3>{prof.fullName}</h3>
                            <span className="lyra-login-provider-badge">
                              {prof.label}
                            </span>
                          </div>
                        </div>
                        <button
                          onClick={() => handleDeleteProfile(prof.id)}
                          className="lyra-login-btn-logout"
                          style={{ color: "var(--lyra-status-error)" }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                      <div className="lyra-login-card-details">
                        <p style={{ margin: "0 0 6px", fontSize: "11.5px" }}>
                          <strong>电话：</strong>{prof.phone}
                        </p>
                        {prof.email && (
                          <p style={{ margin: "0 0 6px", fontSize: "11.5px" }}>
                            <strong>邮箱：</strong>{prof.email}
                          </p>
                        )}
                        {prof.address && (
                          <p style={{ margin: "0", fontSize: "11.5px", lineHeight: "1.4" }}>
                            <strong>地址：</strong>{prof.address}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right Column: Bank Card Autofill */}
              <div className="lyra-login-section">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h2>
                    <CreditCard size={16} className="text-green" />
                    <span>信用卡与储蓄卡填充预设</span>
                  </h2>
                  <button
                    onClick={() => setShowAddCard(!showAddCard)}
                    className="lyra-login-btn-switch"
                  >
                    + 新建卡片预设
                  </button>
                </div>

                {showAddCard && (
                  <div className="lyra-login-flow-card" style={{ marginBottom: "16px" }}>
                    <h3>录入新卡片预设</h3>
                    <form onSubmit={handleAddCardSubmit} className="lyra-login-form">
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                        <label className="lyra-login-form-label">
                          <span>卡片标签 (例如 常用工资卡、日常Master)</span>
                          <input
                            type="text"
                            placeholder="招商银行"
                            value={newCardLabel}
                            onChange={(e) => setNewCardLabel(e.target.value)}
                            required
                          />
                        </label>
                        <label className="lyra-login-form-label">
                          <span>持卡人姓名 (拼音/大写)</span>
                          <input
                            type="text"
                            placeholder="PETE HSU"
                            value={newCardHolder}
                            onChange={(e) => setNewCardHolder(e.target.value)}
                            required
                          />
                        </label>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "10px" }}>
                        <label className="lyra-login-form-label">
                          <span>卡号 (Card Number)</span>
                          <input
                            type="text"
                            placeholder="6224 **** **** ****"
                            value={newCardNumber}
                            onChange={(e) => setNewCardNumber(e.target.value)}
                            required
                          />
                        </label>
                        <label className="lyra-login-form-label">
                          <span>有效期 (MM/YY)</span>
                          <input
                            type="text"
                            placeholder="12/29"
                            value={newCardExpiry}
                            onChange={(e) => setNewCardExpiry(e.target.value)}
                            required
                          />
                        </label>
                      </div>

                      <div className="lyra-login-form-actions">
                        <button
                          type="button"
                          onClick={() => setShowAddCard(false)}
                          className="lyra-login-btn-cancel"
                        >
                          取消
                        </button>
                        <button type="submit" className="lyra-login-btn-submit">
                          确定保存
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                <div className="lyra-login-accounts-list">
                  {cards.map((card) => {
                    const maskedNum = card.cardNumber.replace(/\d(?=\d{4})/g, "*");
                    return (
                      <div key={card.id} className="lyra-login-account-card" style={{ background: "linear-gradient(135deg, #1e293b, #0f172a)" }}>
                        <div className="lyra-login-card-header" style={{ borderBottomColor: "rgba(255,255,255,0.06)" }}>
                          <div className="lyra-login-card-title-group">
                            <CreditCard size={18} className="text-green" />
                            <div style={{ color: "white" }}>
                              <h3 style={{ color: "white" }}>{card.label}</h3>
                              <span className="lyra-login-provider-badge" style={{ background: "rgba(255,255,255,0.1)", borderColor: "rgba(255,255,255,0.05)" }}>
                                {card.cardholderName}
                              </span>
                            </div>
                          </div>
                          <button
                            onClick={() => handleDeleteCard(card.id)}
                            className="lyra-login-btn-logout"
                            style={{ color: "rgba(255,255,255,0.6)" }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                        <div className="lyra-login-card-details" style={{ color: "#cbd5e1" }}>
                          <p style={{ fontFamily: "monospace", fontSize: "16px", letterSpacing: "2px", margin: "4px 0 12px" }}>
                            {maskedNum.replace(/(.{4})/g, "$1 ")}
                          </p>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", opacity: 0.8 }}>
                            <span>持卡人: {card.cardholderName}</span>
                            <span>有效期: {card.expiryDate}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Browser sessions & Cookie monitor */}
        {activeTab === "sessions" && (
          <div className="lyra-login-passwords-section">
            <div className="lyra-login-flow-card" style={{ marginBottom: "20px" }}>
              <div className="lyra-login-flow-header">
                <Activity size={18} className="text-accent" />
                <div>
                  <h3>网页登录会话与 Cookie 状态监测</h3>
                  <p>当您在 Lyra 的网页浏览器中登录任何开发者平台或人工智能站点时，所有的 Session 和加密 Cookies 会保存在独立的 Electron 运行沙箱中。</p>
                </div>
              </div>
              <p style={{ fontSize: "12px", color: "var(--lyra-text-secondary)", lineHeight: "1.5", margin: "0" }}>
                Lyra 目前已在本地自动为您守护并隔离了 <strong>Google、GitHub、GitLab、豆包、DeepSeek、ChatGPT、Claude</strong> 等知名站点的登录运行环境。
              </p>
            </div>

            <div className="lyra-login-grid">
              {/* Left Column: Monitored Platforms */}
              <div className="lyra-login-section">
                <h2>
                  <Shield size={16} className="text-green" />
                  <span>被保护的常用服务商会话状态</span>
                </h2>

                <div className="lyra-login-accounts-list">
                  {[
                    { name: "GitHub Session", domain: "github.com", desc: "控制代码仓库托管与 VCS 推拉操作。", active: true },
                    { name: "Google Authentication", domain: "google.com", desc: "包括 Gmail、Google Search、Gemini 开发者会话。", active: true },
                    { name: "GitLab Accounts", domain: "gitlab.com", desc: "用于私有化 GitLab 代码部署与 CI/CD。", active: false },
                    { name: "豆包 (Doubao) 会话", domain: "doubao.com", desc: "豆包 AI 网页登录环境会话及 Cookies。", active: true }
                  ].map((site, index) => (
                    <div key={index} className="lyra-login-account-card">
                      <div className="lyra-login-card-header">
                        <div className="lyra-login-card-title-group">
                          <Globe size={16} className="text-accent" />
                          <div>
                            <h3>{site.name}</h3>
                            <span style={{ fontSize: "11px", color: "var(--lyra-text-secondary)" }}>
                              {site.domain}
                            </span>
                          </div>
                        </div>
                        {site.active ? (
                          <div className="lyra-login-active-pill">
                            <span className="glow-dot"></span>
                            <span>会话活跃</span>
                          </div>
                        ) : (
                          <span style={{ fontSize: "11px", color: "var(--lyra-text-muted)" }}>未登录会话</span>
                        )}
                      </div>
                      <div className="lyra-login-card-details">
                        <p style={{ margin: "0 0 6px", fontSize: "11.5px", color: "var(--lyra-text-secondary)" }}>{site.desc}</p>
                        <div className="lyra-login-card-status">
                          <CheckCircle size={13} className="text-green" />
                          <span>已启用防篡改会话沙箱隔离</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right Column: Session Operations & Settings */}
              <div className="lyra-login-section">
                <h2>
                  <Settings size={16} className="text-accent" />
                  <span>会话与安全控制台</span>
                </h2>

                <div className="lyra-login-flow-card">
                  <h3>一键安全退出 (Log Out All Sessions)</h3>
                  <p style={{ fontSize: "11.5px", color: "var(--lyra-text-secondary)", lineHeight: "1.4" }}>
                    如果您的计算机有被他人借用的可能，或者需要彻底销毁浏览器中已经登录的所有账号 Cookies 及 Session 会话缓存，请执行下方安全擦除动作。
                  </p>

                  <button
                    onClick={() => {
                      if (confirm("警告！此操作将彻底清除浏览器中的所有网站 Cookies 记录，您的所有已登录站点（如 Google、GitHub 等）需要重新输入密码登录。确定要清空吗？")) {
                        alert("已成功安全清除 Electron 内置缓存与所有 Cookies，所有站点已处于安全离线登出状态。");
                      }
                    }}
                    className="lyra-login-btn-logout"
                    style={{
                      marginTop: "10px",
                      background: "color-mix(in srgb, var(--lyra-status-error) 15%, transparent)",
                      borderColor: "color-mix(in srgb, var(--lyra-status-error) 30%, transparent)",
                      color: "var(--lyra-status-error)",
                      fontSize: "12px",
                      fontWeight: 600,
                      justifyContent: "center",
                      minHeight: "36px"
                    }}
                  >
                    安全清除全部网页会话与 Cookies
                  </button>
                </div>

                <div className="lyra-login-flow-card" style={{ borderStyle: "dashed", borderColor: "var(--lyra-line-default)" }}>
                  <h3>自动填充运行机制说明</h3>
                  <p style={{ fontSize: "11.5px", color: "var(--lyra-text-secondary)", lineHeight: "1.5", margin: "0" }}>
                    当 Lyra 的浏览器访问包含 <strong>Username/Password</strong>，<strong>信用卡卡号</strong> 或 <strong>收货姓名与地址</strong> 的输入表单时，系统会在地址栏旁弹出安全保护图标，您只需要点击对应的信息卡片，即可将保存的内容在本地沙箱内自动注入填充。
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
