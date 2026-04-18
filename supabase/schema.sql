create table brands (id uuid primary key default uuid_generate_v4(), name text unique);
create table models (id uuid primary key default uuid_generate_v4(), brand_id uuid references brands(id), name text);
create table variants (id uuid primary key default uuid_generate_v4(), model_id uuid references models(id), name text, fuel text, transmission text);
create table plans (id uuid primary key default uuid_generate_v4(), variant_id uuid references variants(id), plan_name text, duration_months int, max_kms int);
create table tiers (id uuid primary key default uuid_generate_v4(), plan_id uuid references plans(id), min_days int, max_days int, price_inr decimal(10,2));

-- Performance Indexes
create index idx_models_brand on models(brand_id);
create index idx_variants_model on variants(model_id);
create index idx_plans_variant on plans(variant_id);
create index idx_tier_days on tiers(plan_id, min_days, max_days);

-- RLS (Read-Only Public)
alter table brands enable row level security;
alter table models enable row level security;
alter table variants enable row level security;
alter table plans enable row level security;
alter table tiers enable row level security;
create policy "Public Read" on brands for select using (true);
create policy "Public Read" on models for select using (true);
create policy "Public Read" on variants for select using (true);
create policy "Public Read" on plans for select using (true);
create policy "Public Read" on tiers for select using (true);