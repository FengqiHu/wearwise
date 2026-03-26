import type { Request } from "express";
import { UserRepository } from "../repositories/user-repository.js";
import type { AuthError, PublicUser, UserRecord } from "../types/domain.js";
import { SessionService } from "./session-service.js";

interface AuthResolution {
  user: UserRecord | null;
  error: AuthError | null;
}

export class AuthService {
  constructor(
    private readonly sessionService: SessionService,
    private readonly userRepository: UserRepository
  ) {}

  // resolve the authenticated user from the request, return user details or error
  async resolveAuthenticatedUser(req: Request): Promise<AuthResolution> {
    const token = this.sessionService.readBearerToken(req);

    // identify the user by the token
    if (!token) {
      return {
        user: null,
        error: { status: 401, message: "Missing bearer token." }
      };
    }

    const payload = this.sessionService.verifySessionToken(token);

    if (!payload) {
      return {
        user: null,
        error: { status: 401, message: "Invalid or expired token." }
      };
    }

    // check if user exists
    const user = await this.userRepository.findById(payload.userId);

    if (!user) {
      return {
        user: null,
        error: { status: 401, message: "User for this session was not found." }
      };
    }

    return {
      user,
      error: null
    };
  }

  // convert user record to public user (remove sensitive info) for client
  toPublicUser(user: UserRecord): PublicUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture
    };
  }
}
