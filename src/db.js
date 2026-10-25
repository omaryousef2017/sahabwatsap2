import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';

// service_role: يتجاوز RLS — يُستخدم على الخادم فقط ولا يُرسل أبداً للتطبيق.
export const db = createClient(config.supabase.url, config.supabase.serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
