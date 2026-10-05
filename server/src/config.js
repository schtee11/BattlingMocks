// Single source of truth for which draft the site is running. Every route,
// seed and service reads the year from here instead of hardcoding it, so
// rolling over to the next season is: add the new data files under
// src/data/*-<year>.json and bump this default (or set DRAFT_YEAR in the
// environment). On the next deploy migrate.js seeds the new year's
// prospects / draft order / needs and resets draft_settings.
export const CURRENT_DRAFT_YEAR = parseInt(process.env.DRAFT_YEAR, 10) || 2027;

// The year after the current draft — used for "future pick" trade values.
export const NEXT_DRAFT_YEAR = CURRENT_DRAFT_YEAR + 1;
