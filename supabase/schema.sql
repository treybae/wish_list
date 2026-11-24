-- Wish list app, living in the shared "vibe" Supabase project.
-- Everything this app owns is prefixed wishlist_ so it stays apart from
-- other apps in the same database. Nothing here touches other tables.
--
-- Owner (Trey) signs in with Supabase Auth and manages items.
-- Shoppers use the publishable key with no account: they can only read
-- unclaimed items and claim / unclaim through the wishlist_ functions.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- owner
create table if not exists public.wishlist_owner (
  id    boolean primary key default true check (id),
  email text not null
);
alter table public.wishlist_owner enable row level security;
-- no policies: nobody reads this table through the API
revoke all on public.wishlist_owner from anon, authenticated;

-- True only for a signed-in, email-confirmed account whose email is the owner's.
create or replace function public.wishlist_is_owner()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((
    select true
    from auth.users u
    join public.wishlist_owner o on lower(o.email) = lower(u.email)
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
      and coalesce(u.is_anonymous, false) = false
  ), false)
$$;

-- ---------------------------------------------------------------- items
create table if not exists public.wishlist_items (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 200),
  url        text check (url is null or (url ~* '^https?://' and char_length(url) <= 2000)),
  price      numeric(10,2) check (price is null or price >= 0),
  notes      text check (notes is null or char_length(notes) <= 1000),
  priority   smallint not null default 2 check (priority between 1 and 3), -- 1 high, 2 medium, 3 low
  kind       text not null default 'want' check (kind in ('want','need')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.wishlist_items enable row level security;
revoke all on public.wishlist_items from anon, authenticated;
grant select, insert, update, delete on public.wishlist_items to authenticated;

drop policy if exists wishlist_items_owner_all on public.wishlist_items;
create policy wishlist_items_owner_all on public.wishlist_items
  for all to authenticated
  using ((select public.wishlist_is_owner()))
  with check ((select public.wishlist_is_owner()));

create or replace function public.wishlist_touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists wishlist_items_touch on public.wishlist_items;
create trigger wishlist_items_touch before update on public.wishlist_items
  for each row execute function public.wishlist_touch_updated_at();

-- ---------------------------------------------------------------- claims
create table if not exists public.wishlist_claims (
  item_id      uuid primary key references public.wishlist_items(id) on delete cascade,
  claimer_name text check (claimer_name is null or char_length(claimer_name) <= 80),
  token_hash   text not null,
  created_at   timestamptz not null default now()
);
alter table public.wishlist_claims enable row level security;
revoke all on public.wishlist_claims from anon, authenticated;
grant select, delete on public.wishlist_claims to authenticated;

drop policy if exists wishlist_claims_owner_read on public.wishlist_claims;
create policy wishlist_claims_owner_read on public.wishlist_claims
  for select to authenticated using ((select public.wishlist_is_owner()));
drop policy if exists wishlist_claims_owner_delete on public.wishlist_claims;
create policy wishlist_claims_owner_delete on public.wishlist_claims
  for delete to authenticated using ((select public.wishlist_is_owner()));

-- ---------------------------------------------------------------- shopper RPCs
-- The shared list: every unclaimed item, plus items this browser claimed
-- (matched by the claim tokens it kept). Never says who claimed what.
create or replace function public.wishlist_shared_list(p_tokens text[] default '{}')
returns table (
  id uuid, name text, url text, price numeric, notes text,
  priority smallint, kind text, created_at timestamptz, mine boolean
)
language sql stable security definer
set search_path = ''
as $$
  select i.id, i.name, i.url, i.price, i.notes, i.priority, i.kind, i.created_at,
         (c.item_id is not null) as mine
  from public.wishlist_items i
  left join public.wishlist_claims c on c.item_id = i.id
  where c.item_id is null
     or c.token_hash = any (
          select encode(extensions.digest(t, 'sha256'), 'hex')
          from unnest(coalesce(p_tokens, '{}')) as t
          where t is not null and char_length(t) between 20 and 100
        )
  order by i.kind, i.priority, i.created_at
$$;

-- Claim an item. Returns 'claimed', 'taken' or 'missing'.
create or replace function public.wishlist_claim_item(p_item uuid, p_token text, p_name text default null)
returns text
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  if p_token is null or char_length(p_token) not between 20 and 100 then
    raise exception 'bad token';
  end if;
  if not exists (select 1 from public.wishlist_items where id = p_item) then
    return 'missing';
  end if;
  insert into public.wishlist_claims (item_id, claimer_name, token_hash)
  values (p_item,
          nullif(left(btrim(coalesce(p_name, '')), 80), ''),
          encode(extensions.digest(p_token, 'sha256'), 'hex'))
  on conflict (item_id) do nothing;
  if found then return 'claimed'; end if;
  return 'taken';
end
$$;

-- Undo a claim made from this browser.
create or replace function public.wishlist_unclaim_item(p_item uuid, p_token text)
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  delete from public.wishlist_claims
  where item_id = p_item
    and token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  return found;
end
$$;

revoke all on function public.wishlist_shared_list(text[]) from public, anon, authenticated;
revoke all on function public.wishlist_claim_item(uuid, text, text) from public, anon, authenticated;
revoke all on function public.wishlist_unclaim_item(uuid, text) from public, anon, authenticated;
revoke all on function public.wishlist_is_owner() from public, anon, authenticated;
revoke all on function public.wishlist_touch_updated_at() from public, anon, authenticated;
grant execute on function public.wishlist_shared_list(text[]) to anon, authenticated;
grant execute on function public.wishlist_claim_item(uuid, text, text) to anon, authenticated;
grant execute on function public.wishlist_unclaim_item(uuid, text) to anon, authenticated;
grant execute on function public.wishlist_is_owner() to authenticated;
