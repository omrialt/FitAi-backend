export class CreateUserDto {
  fullName!: string;
  email!: string;
  password!: string;
  role?: string;
  authProvider?: string;
}

export class UpdateUserDto {
  fullName?: string;
  email?: string;
  password?: string;
  role?: string;
}
