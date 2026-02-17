import * as authService from './auth.service.js';

/** Sign-in (login) form config – title, fields (email, password), button, signup link */
export function getLoginForm(req, res) {
  res.json({
    title: 'Sign In',
    fields: [
      { name: 'email', label: 'Email', type: 'email', placeholder: 'Email', required: true },
      { name: 'password', label: 'Password', type: 'password', placeholder: 'Password', required: true },
    ],
    submitButton: { text: 'Sign In' },
    signupPrompt: "Don't have an account?",
    signupLinkText: 'Sign Up',
  });
}

export async function signUp(req, res, next) {
  try {
    console.log('[auth.controller] Received signup request');
    const { email, password, name } = req.body;
    
    if (!email || !password) {
      console.log('[auth.controller] Missing required fields - email:', !!email, 'password:', !!password);
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    console.log('[auth.controller] Signup request for email:', email, 'with name:', name || 'none');
    const result = await authService.signUp(email, password, name);
    console.log('[auth.controller] Signup successful, returning token');
    res.status(201).json(result);
  } catch (e) {
    console.error('[auth.controller] Signup error:', e.message);
    next(e);
  }
}

export async function signIn(req, res, next) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    const result = await authService.signIn(email, password);
    res.json(result);
  } catch (e) {
    next(e);
  }
}

export async function createAdmin(req, res, next) {
  try {
    console.log('[auth.controller] Received create-admin request');
    const { email, password, name } = req.body;
    
    // Check if the requester has a super admin token
    // For super admin, the token is validated in middleware but we need additional check
    // Since super admin token is a special client-side token, we'll validate based on the user
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    
    // Check if token indicates super admin (starts with 'superadmin-token-')
    const isSuperAdmin = token && token.startsWith('superadmin-token-');
    
    if (!isSuperAdmin) {
      console.log('[auth.controller] Unauthorized: Only super admin can create admins');
      return res.status(403).json({ error: 'Only super admin can create admins' });
    }
    
    if (!email || !password || !name) {
      console.log('[auth.controller] Missing required fields');
      return res.status(400).json({ error: 'Name, email and password are required' });
    }
    
    console.log('[auth.controller] Creating admin for email:', email);
    const result = await authService.createAdmin(email, password, name);
    console.log('[auth.controller] Admin created successfully');
    res.status(201).json(result);
  } catch (e) {
    console.error('[auth.controller] Create admin error:', e.message);
    next(e);
  }
}
