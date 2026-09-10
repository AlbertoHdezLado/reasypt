alter table public.rooms
  add column if not exists receipt_image_url text;

insert into storage.buckets (id, name, public)
values ('receipt-images', 'receipt-images', true)
on conflict (id) do update set public = true;