// Valid fixtures: camelCase identifiers (no violations expected)

// Functions — camelCase
export function getUserData() {}
export function h() {} // single lowercase letter
export default function myDefaultFn() {}
export async function fetchRecords() {}
export function* generatorFn() {}

// Variables (let/var) — must be camelCase
let userName = 'alice';
let count123 = 42;
let a = 1; // single lowercase letter
var legacyVar = true;
let x2 = 0; // letter + digit

// Parameters — camelCase
function processOrder(orderId: string, lineItemCount: number, x: boolean) {}
const arrowFn = (userName: string, callback: () => void) => {};

// Methods — camelCase
export class DataService {
  fetchRecords() {}
  private handleError() {}
  public calculateTotal() {}
  async loadData() {}
}

// Properties — camelCase
export class UserModel {
  firstName = '';
  lastName = '';
  private internalId = 0;
  public displayName = '';
  isActive = true; // boolean prefix — still camelCase
}

// Constants — allow UPPER_CASE
export const MAX_RETRIES = 3;
export const API_BASE_URL = 'https://api.example.com';
export const DEFAULT_TIMEOUT = 5000;
export const PI = 3.14;

// Constants — allow camelCase too
export const appVersion = '1.0.0';
export const debugMode = false;
export const config = { key: 'value' };

// Destructuring — variables inside destructure are also checked
const { userName: localName } = { userName: 'bob' };
const [firstItem, secondItem] = [1, 2];
