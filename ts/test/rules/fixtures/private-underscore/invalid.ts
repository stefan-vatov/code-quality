// Invalid fixtures: private members without leading underscore
export class InvalidPrivate {
  private secret = 'hidden'; // no underscore
  private cache = new Map();
  private handleClick() {}
  private computeTotal() {}
  private items: string[] = [];
}

// Public members should not have leading underscore
// (Note: this is stylistic — some people use _ for internal public methods)
// The rule only checks PRIVATE members MUST have _, not that public MUST NOT.
