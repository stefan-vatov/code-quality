// Valid fixtures: PascalCase type names (no violations expected)
export class UserAccount {}
export class HTTPSConnection {}
export class MyClass {}
export class Foo {}

export interface UserProfile {}
export interface IRepository {} // I-prefix allowed
export interface ReadOnly {}

export type UserId = string;
export type AppConfig = { debug: boolean };
export type DeepPartial<T> = { [K in keyof T]?: T[K] };

export enum ColorChoice {
  Red,
  Green,
  Blue,
}

export enum HttpStatusCode {
  OK = 200,
  NotFound = 404,
}
