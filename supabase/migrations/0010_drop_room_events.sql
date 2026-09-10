drop trigger if exists room_events_touch_room on public.room_events;
drop function if exists public.touch_room_from_room_events();
drop table if exists public.room_events;
