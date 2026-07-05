export const ADMIN_SESSION_COOKIE = "football_admin_session";

export function getAdminCredentials() {
  return {
    username: process.env.ADMIN_USERNAME ?? "admin",
    password: process.env.ADMIN_PASSWORD ?? "admin123"
  };
}

export function getAdminSessionToken() {
  const credentials = getAdminCredentials();
  return (
    process.env.ADMIN_SESSION_TOKEN ??
    `football-admin:${credentials.username}:${credentials.password}`
  );
}
