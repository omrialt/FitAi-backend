import { Injectable, NotFoundException } from '@nestjs/common';
import { TrainerAccessService } from '../../common/trainer-access/trainer-access.service';
import type { Requester } from '../../utils/ownership';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserDocument } from './user.schema';
import * as bcrypt from 'bcrypt';
import { CreateUserDto, UpdateUserDto } from '../../interfaces/user.interfaces';

/**
 * What another account may see about a user (SEC-01). An allowlist, not a
 * denylist: a field added to the schema later stays private until someone
 * decides it belongs here.
 *
 * Plain users get enough to recognise a person in a share picker or as the
 * author of a plan. Trainers also get the email, because the invite dialog
 * identifies candidates by it.
 */
const PUBLIC_USER_FIELDS = '_id fullName avatarUrl role';
const TRAINER_VISIBLE_FIELDS = `${PUBLIC_USER_FIELDS} email`;

@Injectable()
export class UserService {
  constructor(
    @InjectModel('User') private userModel: Model<UserDocument>,
    private readonly trainerAccess: TrainerAccessService,
  ) {}

  async create(createUserDto: CreateUserDto): Promise<UserDocument> {
    const hashedPassword = await bcrypt.hash(createUserDto.password, 10);
    const createdUser = new this.userModel({
      ...createUserDto,
      password: hashedPassword,
    });
    return createdUser.save();
  }

  async findAll(): Promise<UserDocument[]> {
    return this.userModel.find().select('-password').exec();
  }

  /**
   * The user directory, cut to what the caller's role may see (SEC-01).
   *
   * This route used to hand every signed-in account the full document of every
   * user, reset tokens and Google credentials included. Admins still get whole
   * profiles (secrets are hidden by the schema); everyone else gets the public
   * allowlist above.
   */
  async findAllFor(requester: Requester): Promise<UserDocument[]> {
    if (requester.role === 'admin') {
      return this.findAll();
    }
    const fields =
      requester.role === 'trainer'
        ? TRAINER_VISIBLE_FIELDS
        : PUBLIC_USER_FIELDS;
    return this.userModel.find().select(fields).exec();
  }

  /**
   * One user, at the depth the caller is entitled to (SEC-01): the full
   * profile for yourself, an admin, or a trainer the user accepted; the public
   * allowlist for anyone else (enough to show a plan's author by name).
   */
  async findOneFor(id: string, requester: Requester): Promise<UserDocument> {
    const full =
      requester.id === id ||
      requester.role === 'admin' ||
      (requester.role === 'trainer' &&
        (await this.trainerAccess.isAcceptedTrainerOf(requester.id, id)));

    if (full) {
      return this.findOne(id);
    }

    const user = await this.userModel
      .findById(id)
      .select(PUBLIC_USER_FIELDS)
      .exec();
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return user;
  }

  async findOne(id: string): Promise<UserDocument> {
    const user = await this.userModel.findById(id).select('-password').exec();
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return user;
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email }).select('+password').exec();
  }

  async update(
    id: string,
    updateUserDto: UpdateUserDto,
  ): Promise<UserDocument> {
    const updateData = { ...updateUserDto };

    if (updateUserDto.password) {
      updateData.password = await bcrypt.hash(updateUserDto.password, 10);
    }

    const updatedUser = await this.userModel
      .findByIdAndUpdate(id, updateData, { new: true })
      .select('-password')
      .exec();

    if (!updatedUser) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return updatedUser;
  }

  async remove(id: string): Promise<UserDocument> {
    const deletedUser = await this.userModel
      .findByIdAndDelete(id)
      .select('-password')
      .exec();
    if (!deletedUser) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return deletedUser;
  }

  async validatePassword(
    plainPassword: string,
    hashedPassword: string,
  ): Promise<boolean> {
    return bcrypt.compare(plainPassword, hashedPassword);
  }
}
