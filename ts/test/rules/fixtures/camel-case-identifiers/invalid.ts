// Invalid fixtures: non-camelCase identifiers (violations expected)

// PascalCase variables
let UserName = 'alice';
let TotalCount = 42;

// snake_case variables
let user_name = 'bob';
let total_count = 100;

// SCREAMING_SNAKE variables (not const)
let MAX_RETRIES = 5;
let API_KEY_ID = 'abc';

// PascalCase functions
export function GetUserData() {}
export function ProcessOrder() {}

// snake_case functions
export function get_user_data() {}
export function process_order() {}

// PascalCase parameters
function processOrder(OrderId: string, LineItem: number) {}

// SCREAMING_SNAKE parameters
function fetchData(ApiKey: string, _Timeout: number) {}

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
