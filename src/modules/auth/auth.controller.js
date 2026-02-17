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
