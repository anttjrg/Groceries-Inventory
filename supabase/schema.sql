create table if not exists public.products (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  category text not null,
  quantity numeric not null default 0 check (quantity >= 0),
  unit text not null,
  cost numeric not null default 0,
  price numeric not null default 0,
  reorder_level numeric not null default 0,
  expiry_date date
);

create table if not exists public.movements (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  product_id text references public.products(id) on delete set null,
  product_name text not null,
  type text not null check (type in ('purchase', 'sale')),
  quantity numeric not null check (quantity > 0),
  unit_price numeric not null,
  unit_cost numeric,
  date date not null,
  note text not null default ''
);

create table if not exists public.gcash_transactions (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  service text not null,
  amount numeric not null,
  fee numeric not null default 0,
  customer_name text not null default '',
  phone_number text not null default '',
  reference text not null default ''
);

alter table public.products
  add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.products alter column user_id set default auth.uid();
alter table public.movements
  add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.movements alter column user_id set default auth.uid();
alter table public.gcash_transactions
  add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.gcash_transactions alter column user_id set default auth.uid();

alter table public.products enable row level security;
alter table public.movements enable row level security;
alter table public.gcash_transactions enable row level security;

revoke all on public.products, public.movements, public.gcash_transactions from anon;
grant select, insert, update, delete on public.products, public.movements, public.gcash_transactions to authenticated;

drop policy if exists "Shop users manage their products" on public.products;
create policy "Shop users manage their products" on public.products
  for all to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "Shop users manage their movements" on public.movements;
create policy "Shop users manage their movements" on public.movements
  for all to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "Shop users manage their GCash transactions" on public.gcash_transactions;
create policy "Shop users manage their GCash transactions" on public.gcash_transactions
  for all to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create or replace function public.create_product_with_opening_stock(
  p_product jsonb,
  p_movement jsonb default null
) returns void
language plpgsql
as $$
begin
  insert into public.products (
    id, user_id, name, category, quantity, unit, cost, price, reorder_level, expiry_date
  ) values (
    p_product->>'id', auth.uid(), p_product->>'name', p_product->>'category',
    (p_product->>'quantity')::numeric, p_product->>'unit', (p_product->>'cost')::numeric,
    (p_product->>'price')::numeric, (p_product->>'reorderLevel')::numeric,
    nullif(p_product->>'expiryDate', '')::date
  );

  if p_movement is not null then
    insert into public.movements (
      id, user_id, product_id, product_name, type, quantity, unit_price, unit_cost, date, note
    ) values (
      p_movement->>'id', auth.uid(), p_movement->>'productId', p_movement->>'productName',
      p_movement->>'type', (p_movement->>'quantity')::numeric, (p_movement->>'unitPrice')::numeric,
      nullif(p_movement->>'unitCost', '')::numeric, (p_movement->>'date')::date, p_movement->>'note'
    );
  end if;
end;
$$;

create or replace function public.record_stock_movement(p_movement jsonb)
returns void
language plpgsql
as $$
declare
  v_product public.products%rowtype;
  v_quantity numeric := (p_movement->>'quantity')::numeric;
  v_type text := p_movement->>'type';
begin
  select * into v_product from public.products
  where id = p_movement->>'productId' and user_id = auth.uid()
  for update;
  if not found then raise exception 'Product not found'; end if;
  if v_quantity <= 0 then raise exception 'Quantity must be greater than zero'; end if;
  if v_type not in ('purchase', 'sale') then raise exception 'Invalid movement type'; end if;
  if v_type = 'sale' and v_quantity > v_product.quantity then
    raise exception 'Insufficient stock';
  end if;

  update public.products set
    quantity = quantity + case when v_type = 'purchase' then v_quantity else -v_quantity end,
    cost = case when v_type = 'purchase' then (p_movement->>'unitPrice')::numeric else cost end,
    expiry_date = case
      when v_type = 'purchase' and nullif(p_movement->>'expiryDate', '') is not null
        then (p_movement->>'expiryDate')::date
      else expiry_date
    end
  where id = v_product.id;

  insert into public.movements (
    id, user_id, product_id, product_name, type, quantity, unit_price, unit_cost, date, note
  ) values (
    p_movement->>'id', auth.uid(), v_product.id, p_movement->>'productName', v_type,
    v_quantity, (p_movement->>'unitPrice')::numeric,
    nullif(p_movement->>'unitCost', '')::numeric, (p_movement->>'date')::date, p_movement->>'note'
  );
end;
$$;

create or replace function public.update_stock_movement(p_movement jsonb)
returns void
language plpgsql
as $$
declare
  v_old public.movements%rowtype;
  v_product public.products%rowtype;
  v_quantity numeric := (p_movement->>'quantity')::numeric;
  v_next_quantity numeric;
begin
  select * into v_old from public.movements
  where id = p_movement->>'id' and user_id = auth.uid()
  for update;
  if not found then raise exception 'Movement not found'; end if;
  select * into v_product from public.products
  where id = v_old.product_id and user_id = auth.uid()
  for update;
  if not found then raise exception 'Product not found'; end if;
  if v_quantity <= 0 then raise exception 'Quantity must be greater than zero'; end if;

  v_next_quantity := v_product.quantity
    - case when v_old.type = 'purchase' then v_old.quantity else -v_old.quantity end
    + case when v_old.type = 'purchase' then v_quantity else -v_quantity end;
  if v_next_quantity < 0 then raise exception 'Cannot reduce stock below zero'; end if;

  update public.movements set
    quantity = v_quantity,
    unit_price = (p_movement->>'unitPrice')::numeric,
    unit_cost = nullif(p_movement->>'unitCost', '')::numeric,
    date = (p_movement->>'date')::date,
    note = p_movement->>'note'
  where id = v_old.id;

  update public.products set
    quantity = v_next_quantity,
    cost = coalesce((
      select unit_price from public.movements
      where product_id = v_product.id and user_id = auth.uid() and type = 'purchase'
      order by date desc limit 1
    ), cost)
  where id = v_product.id;
end;
$$;

create or replace function public.delete_stock_movement(p_movement_id text)
returns void
language plpgsql
as $$
declare
  v_movement public.movements%rowtype;
  v_product public.products%rowtype;
  v_next_quantity numeric;
begin
  select * into v_movement from public.movements
  where id = p_movement_id and user_id = auth.uid()
  for update;
  if not found then raise exception 'Movement not found'; end if;
  select * into v_product from public.products
  where id = v_movement.product_id and user_id = auth.uid()
  for update;
  if not found then raise exception 'Product not found'; end if;

  v_next_quantity := v_product.quantity
    - case when v_movement.type = 'purchase' then v_movement.quantity else -v_movement.quantity end;
  if v_next_quantity < 0 then raise exception 'Cannot remove this purchase; stock would be negative'; end if;
  delete from public.movements where id = v_movement.id;

  update public.products set
    quantity = v_next_quantity,
    cost = case when v_movement.type = 'purchase' then coalesce((
      select unit_price from public.movements
      where product_id = v_product.id and user_id = auth.uid() and type = 'purchase'
      order by date desc limit 1
    ), cost) else cost end
  where id = v_product.id;
end;
$$;

create or replace function public.import_legacy_records(
  p_products jsonb,
  p_movements jsonb,
  p_gcash_transactions jsonb
) returns void
language plpgsql
as $$
begin
  insert into public.products as existing (
    id, user_id, name, category, quantity, unit, cost, price, reorder_level, expiry_date
  )
  select
    item->>'id', auth.uid(), item->>'name', item->>'category',
    (item->>'quantity')::numeric, item->>'unit', (item->>'cost')::numeric,
    (item->>'price')::numeric, (item->>'reorderLevel')::numeric,
    nullif(item->>'expiryDate', '')::date
  from jsonb_array_elements(p_products) as source(item)
  on conflict (id) do update set
    name = excluded.name, category = excluded.category, quantity = excluded.quantity,
    unit = excluded.unit, cost = excluded.cost, price = excluded.price,
    reorder_level = excluded.reorder_level, expiry_date = excluded.expiry_date
  where existing.user_id = auth.uid();

  insert into public.movements as existing (
    id, user_id, product_id, product_name, type, quantity, unit_price, unit_cost, date, note
  )
  select
    item->>'id', auth.uid(), nullif(item->>'productId', ''), item->>'productName',
    item->>'type', (item->>'quantity')::numeric, (item->>'unitPrice')::numeric,
    nullif(item->>'unitCost', '')::numeric, (item->>'date')::date, coalesce(item->>'note', '')
  from jsonb_array_elements(p_movements) as source(item)
  where nullif(item->>'productId', '') is null
    or exists (
      select 1 from public.products product
      where product.id = item->>'productId' and product.user_id = auth.uid()
    )
  on conflict (id) do update set
    product_id = excluded.product_id, product_name = excluded.product_name,
    type = excluded.type, quantity = excluded.quantity, unit_price = excluded.unit_price,
    unit_cost = excluded.unit_cost, date = excluded.date, note = excluded.note
  where existing.user_id = auth.uid();

  insert into public.gcash_transactions as existing (
    id, user_id, date, service, amount, fee, customer_name, phone_number, reference
  )
  select
    item->>'id', auth.uid(), (item->>'date')::date, item->>'service',
    (item->>'amount')::numeric, coalesce((item->>'fee')::numeric, 0),
    coalesce(item->>'customerName', ''), coalesce(item->>'phoneNumber', ''),
    coalesce(item->>'reference', '')
  from jsonb_array_elements(p_gcash_transactions) as source(item)
  on conflict (id) do update set
    date = excluded.date, service = excluded.service, amount = excluded.amount,
    fee = excluded.fee, customer_name = excluded.customer_name,
    phone_number = excluded.phone_number, reference = excluded.reference
  where existing.user_id = auth.uid();
end;
$$;

revoke all on function public.import_legacy_records(jsonb, jsonb, jsonb) from public, anon;
revoke all on function public.create_product_with_opening_stock(jsonb, jsonb) from public, anon;
revoke all on function public.record_stock_movement(jsonb) from public, anon;
revoke all on function public.update_stock_movement(jsonb) from public, anon;
revoke all on function public.delete_stock_movement(text) from public, anon;
grant execute on function public.create_product_with_opening_stock(jsonb, jsonb) to authenticated;
grant execute on function public.record_stock_movement(jsonb) to authenticated;
grant execute on function public.update_stock_movement(jsonb) to authenticated;
grant execute on function public.delete_stock_movement(text) to authenticated;
grant execute on function public.import_legacy_records(jsonb, jsonb, jsonb) to authenticated;
