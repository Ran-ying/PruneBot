const { createHmac, createHash, timingSafeEqual } = require("node:crypto");

const COOKIE_NAME = "qqbot_history_session";
const DEFAULT_SESSION_HOURS = 24;
const MAX_FAILURES = 5;
const BLOCK_DURATION_MS = 60_000;

function hash(value) {
  return createHash("sha256").update(String(value || "")).digest();
}

function safeEqual(left, right) {
  return timingSafeEqual(hash(left), hash(right));
}

function parseCookies(header = "") {
  return String(header).split(";").reduce((cookies, part) => {
    const separator = part.indexOf("=");
    if (separator < 0) return cookies;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) cookies[key] = value;
    return cookies;
  }, {});
}

function isSecureRequest(request) {
  const forwardedProto = String(request.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  return Boolean(request.socket?.encrypted) || forwardedProto === "https";
}

function createChatHistoryAuth({
  password = "",
  sessionHours = DEFAULT_SESSION_HOURS,
  now = () => Date.now(),
} = {}) {
  const normalizedPassword = String(password || "");
  const enabled = normalizedPassword.length > 0;
  const sessionSeconds = Math.max(1, Number(sessionHours) || DEFAULT_SESSION_HOURS) * 3600;
  const failures = new Map();

  function sign(expiresAt) {
    return createHmac("sha256", normalizedPassword)
      .update(`v1.${expiresAt}`)
      .digest("base64url");
  }

  function createToken() {
    const expiresAt = now() + sessionSeconds * 1000;
    return `v1.${expiresAt}.${sign(expiresAt)}`;
  }

  function verifyToken(token) {
    if (!enabled) return true;
    const [version, expiresAtText, signature, ...extra] = String(token || "").split(".");
    const expiresAt = Number(expiresAtText);
    if (
      version !== "v1"
      || extra.length > 0
      || !Number.isFinite(expiresAt)
      || expiresAt <= now()
    ) return false;
    return safeEqual(signature, sign(expiresAt));
  }

  function isAuthenticated(request) {
    if (!enabled) return true;
    return verifyToken(parseCookies(request.headers.cookie)[COOKIE_NAME]);
  }

  function createSessionCookie(request) {
    const secure = isSecureRequest(request) ? "; Secure" : "";
    return `${COOKIE_NAME}=${createToken()}; Path=/; Max-Age=${sessionSeconds}; HttpOnly; SameSite=Strict${secure}`;
  }

  function createExpiredCookie(request) {
    const secure = isSecureRequest(request) ? "; Secure" : "";
    return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${secure}`;
  }

  function getClientKey(request) {
    return String(request.headers["x-forwarded-for"] || request.socket?.remoteAddress || "unknown")
      .split(",")[0]
      .trim();
  }

  function getRetryAfter(request) {
    const key = getClientKey(request);
    const entry = failures.get(key);
    if (!entry || entry.blockedUntil <= now()) {
      if (entry?.blockedUntil) failures.delete(key);
      return 0;
    }
    return Math.max(1, Math.ceil((entry.blockedUntil - now()) / 1000));
  }

  function recordFailure(request) {
    const key = getClientKey(request);
    const entry = failures.get(key) || { count: 0, blockedUntil: 0 };
    entry.count += 1;
    if (entry.count >= MAX_FAILURES) {
      entry.count = 0;
      entry.blockedUntil = now() + BLOCK_DURATION_MS;
    }
    failures.set(key, entry);
  }

  function recordSuccess(request) {
    failures.delete(getClientKey(request));
  }

  return {
    enabled,
    createExpiredCookie,
    createSessionCookie,
    getRetryAfter,
    isAuthenticated,
    recordFailure,
    recordSuccess,
    verifyPassword(candidate) {
      return enabled && safeEqual(candidate, normalizedPassword);
    },
  };
}

module.exports = {
  COOKIE_NAME,
  createChatHistoryAuth,
  parseCookies,
  safeEqual,
};
