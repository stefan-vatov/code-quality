// Invalid fixtures: non-camelCase identifiers (violations expected)

// PascalCase variables
let UserName = 'alice';
let TotalCount = 42;
var LegacyVar = true;

// snake_case variables
let user_name = 'bob';
let total_count = 100;
var legacy_var = true;

// PascalCase functions
export function GetUserData() {}
export function ProcessOrder() {}

// snake_case functions
export function get_user_data() {}
export function process_order() {}

// PascalCase parameters
function processOrder(OrderId: string, LineItem: number) {}

// snake_case parameters
function fetchData(user_name: string, total_count: number) {}

// SCREAMING_SNAKE params
function loadConfig(ApiKey: string) {}

// Single uppercase letter (not valid camelCase)
let X = 5;
function Y() {}

// Leading underscore (separate convention)
let _privateVar = 42;

// PascalCase methods
export class BadService {
  FetchRecords() {}
  CalculateTotal() {}
}

// snake_case methods
export class BadService2 {
  fetch_records() {}
  calculate_total() {}
}

// PascalCase properties
export class BadModel {
  FirstName = '';
  LastName = '';
}

// snake_case properties
export class BadModel2 {
  first_name = '';
  last_name = '';
}
