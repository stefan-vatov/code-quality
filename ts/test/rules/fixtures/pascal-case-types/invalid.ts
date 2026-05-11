// Invalid fixtures: non-PascalCase type names (violations expected)
export class userAccount {} // lowercase start
export class my_class {} // snake_case
export class HTTPSCONNECTION {} // all caps
export class Foo_Bar {} // underscore in name

export interface userProfile {}
export interface my_interface {}

export type userId = string; // camelCase
export type app_config = { debug: boolean };

export enum colorChoice {
  // lowercase
  Red,
  Green,
}

export enum HTTP_STATUS_CODE {
  // SCREAMING_SNAKE
  OK = 200,
  NotFound = 404,
}
