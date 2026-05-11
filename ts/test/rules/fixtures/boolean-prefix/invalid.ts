// Invalid fixtures: boolean variables without is_/has_/should_ prefix

// Booleans missing prefix — type annotated
const visible: boolean = true;
let error: boolean = false;
const loading: boolean = true;
var ready: boolean = false;

// Booleans missing prefix — literal init
const active = true;
let enabled = false;
const open = true;
var closed = false;

// Booleans missing prefix — SCREAMING
const VISIBLE = true;
const ACTIVE = false;
