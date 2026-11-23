/** `GET /api/users/directory` item (docs/API_DESIGN.md "User directory"). */
export interface DirectoryUser {
  id: string;
  displayName: string;
  email: string;
}
