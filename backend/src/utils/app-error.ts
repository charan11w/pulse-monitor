export class AppError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, statusCode: number, code: string) {
    //initiate message in the parent;
    super(message);

    this.statusCode = statusCode;
    this.code = code;
  }
}
