// Valid fixtures: camelCase identifiers (no violations expected)

// Functions
export function getUserData() {}
export function h() {} // single lowercase letter ok
export default function myDefaultFn() {}

// Variables (let/var)
let userName = 'alice';
let count123 = 42;
var legacyVar = true;

// Parameters
function processOrder(orderId: string, lineItemCount: number) {}

// Methods
export class DataService {
  fetchRecords() {}
  private handleError() {}
  public calculateTotal() {}
}

// Properties
export class UserModel {
  firstName = '';
  lastName = '';
  private internalId = 0;
  public displayName = '';
}

// Constants (allow UPPER_CASE)
export const MAX_RETRIES = 3;
export const API_BASE_URL = 'https://api.example.com';
export const DEFAULT_TIMEOUT = 5000;

// Constants (allow camelCase too)
export const appVersion = '1.0.0';
export const debugMode = false;
