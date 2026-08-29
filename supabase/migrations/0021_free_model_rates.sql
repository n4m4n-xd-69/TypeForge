-- Prices the models whose price is actually known.
--
-- 0019 seeded 36 models with every rate NULL, which the console correctly
-- reports as "unrated" — but eight of them carry OpenRouter's `:free` suffix,
-- and for those zero is a fact rather than a guess. Leaving a known-free model
-- unrated understates how much of the traffic the spend estimate could
-- actually account for, which is the same failure as inventing a rate, just
-- pointing the other way.
--
-- The other 28 stay NULL. Their real rates depend on a contract this project
-- does not have visible, and a plausible-looking number in a cost column is
-- something an operator will eventually budget against.

update public.ai_models
   set input_cost_per_1k  = 0,
       output_cost_per_1k = 0,
       updated_at         = now()
 where model like '%:free'
   and input_cost_per_1k is null
   and output_cost_per_1k is null;

comment on column public.ai_models.input_cost_per_1k is
  'Dollars per 1000 prompt tokens. NULL means UNRATED and is not zero — the '
  'console reports unrated call counts alongside every spend estimate rather '
  'than counting an unpriced model as free.';
