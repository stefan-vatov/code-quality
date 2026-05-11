// Valid fixtures: private members with leading underscore
export class ValidPrivate {
  private _secret = 'hidden';
  private _cache = new Map();
  private _internalState = 0;
  private _handleClick() {}
  private _computeTotal() {}
  private _items: string[] = [];
}

// Public members without underscore (also valid — no underscore required for public)
export class ValidPublic {
  public visible = 'shown';
  public calculatePrice() {}
  displayName = ''; // public by default
  fetchData() {} // public by default
}

// Protected members — underscore not required (only private)
export class ValidProtected {
  protected _protectedOk = 1; // underscore on protected is fine
  protected memberAlsoOk = 2;
}

// Single underscore is valid for private (length > 1 check)
export class SingleUnderscore {
  private _x = 0; // _x is valid (length 2)
}
