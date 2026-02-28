import express from 'express';

const router = express.Router();

const sessions = new Map();

function generateSessionId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 48; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

const LDAP_CONFIG = {
  url: process.env.LDAP_URI || '',
  baseDN: process.env.LDAP_BASEDN || '',
  domain: process.env.LDAP_DOMAIN || '',
  adminEntitlement: process.env.LDAP_ROLES_MAPPING_ADMIN || '',
  devEntitlement: process.env.LDAP_ROLES_MAPPING_DEV || '',
  tlsRejectUnauthorized: process.env.LDAP_TLS_REJECT_UNAUTHORIZED !== 'false',
};

function determineRole(memberOf) {
  if (!memberOf) return 'viewer';
  const groups = Array.isArray(memberOf) ? memberOf : [memberOf];
  if (LDAP_CONFIG.adminEntitlement && groups.some(g => g.includes(LDAP_CONFIG.adminEntitlement))) {
    return 'admin';
  }
  if (LDAP_CONFIG.devEntitlement && groups.some(g => g.includes(LDAP_CONFIG.devEntitlement))) {
    return 'developer';
  }
  return 'viewer';
}

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username?.trim() || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const isDemoMode = process.env.LDAP_DEMO_MODE === 'true' || !LDAP_CONFIG.url || !LDAP_CONFIG.baseDN;

  if (isDemoMode) {
    if (username === 'admin' && password === 'admin') {
      const sessionId = generateSessionId();
      const user = {
        id: '1',
        username: 'admin',
        name: 'Admin User',
        email: 'admin@dataflow.local',
        role: 'admin',
        firstName: 'Admin',
        memberOf: [],
      };
      sessions.set(sessionId, { user, createdAt: Date.now() });
      return res.json({ success: true, sessionId, user });
    }
    return res.status(401).json({ error: 'Invalid credentials. Demo mode: use admin / admin' });
  }

  try {
    const { authenticate } = await import('ldap-authentication');

    const userDn = `${username}@${LDAP_CONFIG.domain}`;

    const options = {
      ldapOpts: {
        url: LDAP_CONFIG.url,
        tlsOptions: { rejectUnauthorized: LDAP_CONFIG.tlsRejectUnauthorized },
      },
      userDn: userDn,
      userPassword: password,
      userSearchBase: LDAP_CONFIG.baseDN,
      usernameAttribute: 'sAMAccountName',
      username: username,
    };

    const ldapUser = await authenticate(options);

    if (!ldapUser) {
      return res.status(401).json({ error: 'Authentication failed — invalid credentials' });
    }

    const role = determineRole(ldapUser.memberOf);
    const sessionId = generateSessionId();
    const user = {
      id: ldapUser.uid || ldapUser.sAMAccountName || username,
      username: ldapUser.cn || username,
      name: ldapUser.cn || ldapUser.displayName || username,
      email: ldapUser.mail || ldapUser.userPrincipalName || `${username}@${LDAP_CONFIG.domain}`,
      role,
      firstName: ldapUser.givenName || ldapUser.cn?.split(' ')[0] || username,
      memberOf: ldapUser.memberOf || [],
    };

    sessions.set(sessionId, { user, createdAt: Date.now() });

    console.log(`[LDAP] User authenticated: ${user.name} (role: ${role})`);
    res.json({ success: true, sessionId, user });
  } catch (err) {
    console.error('[LDAP] Authentication error:', err.message || err);

    let errorMsg = 'Authentication failed';
    if (err.message?.includes('ECONNREFUSED') || err.message?.includes('ENOTFOUND')) {
      errorMsg = 'LDAP server is unreachable. Please contact your administrator.';
    } else if (err.message?.includes('Invalid credentials') || err.message?.includes('52e')) {
      errorMsg = 'Invalid username or password';
    } else if (err.message?.includes('timeout') || err.message?.includes('ETIMEDOUT')) {
      errorMsg = 'LDAP server connection timed out. Please try again.';
    } else if (err.message?.includes('certificate') || err.message?.includes('CERT')) {
      errorMsg = 'LDAP SSL certificate error. Please contact your administrator.';
    }

    res.status(401).json({ error: errorMsg });
  }
});

router.post('/logout', (req, res) => {
  const sessionId = req.headers['x-session-id'];
  if (sessionId) sessions.delete(sessionId);
  res.json({ success: true });
});

router.get('/me', (req, res) => {
  const sessionId = req.headers['x-session-id'];
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId);
    const MAX_SESSION_AGE = 8 * 60 * 60 * 1000;
    if (Date.now() - session.createdAt > MAX_SESSION_AGE) {
      sessions.delete(sessionId);
      return res.status(401).json({ error: 'Session expired' });
    }
    return res.json({ ...session.user, is_authenticated: true });
  }
  res.status(401).json({ error: 'Not authenticated' });
});

setInterval(() => {
  const MAX_AGE = 8 * 60 * 60 * 1000;
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > MAX_AGE) sessions.delete(id);
  }
}, 30 * 60 * 1000);

export default router;
