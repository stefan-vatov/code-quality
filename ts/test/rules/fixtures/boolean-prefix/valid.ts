// Valid fixtures: boolean variables with correct is_/has_/should_ prefix

// is_ prefix
export const isEnabled = true;
const isLoading = false;
let isActive = true;
let isReady = false;

// has_ prefix
const hasAccess = true;
export let hasPermission = false;
const hasChildren = true;

// should_ prefix
let shouldUpdate = false;
export const shouldRetry = true;
const shouldRender = true;

// SCREAMING_SNAKE booleans
export const IS_ENABLED = true;
const HAS_ACCESS = false;
const SHOULD_RETRY = true;

// snake_case booleans
const is_enabled = false;
let has_access = true;
const should_update = false;

// Type-annotated booleans
const isVisible: boolean = true;
let hasError: boolean = false;
const shouldRefresh: boolean = true;
