-- Optional manual alternative to: npm run setup:admin
-- Run in SQL Editor with role = postgres (not authenticated).
insert into agents (auth_user_id, name, phone, department_id, role, approval_status, phone_verified_at)
select '08556850-b342-49e7-a7ee-798266a58818', 'Sahab Admin', '201018034143',
       (select id from departments where code = 'management'), 'admin', 'approved', now()
where not exists (select 1 from agents where auth_user_id = '08556850-b342-49e7-a7ee-798266a58818');
