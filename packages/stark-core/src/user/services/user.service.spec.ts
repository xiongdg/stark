"use strict";

import Spy = jasmine.Spy;
import createSpyObj = jasmine.createSpyObj;
import { Store } from "@ngrx/store";
import { Observer } from "rxjs/Observer";
import { of } from "rxjs/observable/of";
import { _throw as observableThrow } from "rxjs/observable/throw";
import { Deserialize } from "cerialize";

import {
	GetAllUsers,
	GetAllUsersFailure,
	GetAllUsersSuccess,
	StarkUserActionTypes,
	FetchUserProfile,
	FetchUserProfileSuccess,
	FetchUserProfileFailure,
	SetUser
} from "../actions/index";
import { StarkUser } from "../entities/index";
import { StarkUserService } from "./user.service.intf";
import { StarkUserServiceImpl } from "./user.service";
import { StarkLoggingService } from "../../logging/services/logging.service.intf";
import { MockStarkLoggingService } from "../../logging/testing/index";
import { MockStarkSessionService } from "../../session/testing/index";
import { StarkUserRepository } from "../repository/index";
import {
	StarkHttpError,
	StarkHttpErrorWrapper,
	StarkHttpErrorWrapperImpl,
	StarkSingleItemResponseWrapper,
	StarkSingleItemResponseWrapperImpl
} from "../../http/entities";
import { StarkHttpStatusCodes } from "../../http/enumerators/index";
import { StarkSessionService } from "../../session/services/index";
import { HttpErrorResponse } from "@angular/common/http";
import { StarkHttpErrorImpl } from "../../http";

interface StarkUserWithCustomData extends Pick<StarkUser, "uuid" | "username" | "roles"> {
	[prop: string]: any;
}

describe("Service: StarkUserService", () => {
	let userService: StarkUserService;
	let mockStore: Store<any>;
	let mockUserRepository: StarkUserRepository;
	let mockLogger: StarkLoggingService;
	let mockSessionService: StarkSessionService;

	let mockData: any;
	let mockUsers: StarkUserWithCustomData[];
	let mockUserCustomData: { [prop: string]: any };
	let mockUserCustomData2: { [prop: string]: any };
	let mockUserInstances: StarkUser[];
	let mockObserver: Observer<any>;

	beforeEach(() => {
		mockLogger = new MockStarkLoggingService();
		mockUserRepository = jasmine.createSpyObj("starkUserRepository", ["getUser"]);
		mockStore = jasmine.createSpyObj("store", ["select", "dispatch"]);
		mockData = { profiles: [] };
		mockUserCustomData = {
			prop1: 1234,
			prop2: "whatever",
			prop3: "2016-03-18T18:25:43.511Z",
			prop4: ["some value", "false", "null", "", true, false, 0, { name: "Christopher", surname: "Cortes" }]
		};
		mockUserCustomData2 = {
			...mockUserCustomData,
			prop4: ["some value", "false", "null", "", true, false, 0, { name: "Alexis", surname: "Georges" }]
		};
		mockUsers = [
			{
				uuid: "1",
				username: "ccortes",
				roles: [],
				details: {
					firstName: "Christopher",
					lastName: "Cortes",
					language: "EN",
					mail: "ccortes@nbb.be",
					referenceNumber: "1234"
				},
				custom: mockUserCustomData
			},
			{
				uuid: "2",
				username: "ageorges",
				roles: [],
				details: {
					firstName: "Alexis",
					lastName: "Georges",
					language: "FR",
					mail: "ageorges@nbb.be",
					referenceNumber: "4321"
				},
				custom: mockUserCustomData2
			}
		];
		mockUserInstances = [Deserialize(mockUsers[0], StarkUser), Deserialize(mockUsers[1], StarkUser)];
		mockObserver = createSpyObj<Observer<any>>("observerSpy", ["next", "error", "complete"]);

		(<Spy>mockStore.select).and.returnValue(of(mockUserInstances[0]));
		mockSessionService = new MockStarkSessionService();

		userService = new StarkUserServiceImpl(mockLogger, mockSessionService, mockStore, mockUserRepository, mockData);
	});

	describe("getUser", () => {
		it("should get user state observable", () => {
			userService.getUser().subscribe(mockObserver);

			expect(mockObserver.next).toHaveBeenCalledTimes(1);
			const result: StarkUser = (<Spy>mockObserver.next).calls.argsFor(0)[0];
			expect(result).toBeDefined();
			expect(result instanceof StarkUser).toBe(true);
			expect((<StarkUser>result).uuid).toBe(mockUsers[0].uuid);
			expect((<StarkUser>result).firstName).toBe(mockUsers[0].details.firstName);
			expect((<StarkUser>result).lastName).toBe(mockUsers[0].details.lastName);
			expect((<StarkUser>result).language).toBe(mockUsers[0].details.language);
			expect((<StarkUser>result).email).toBe(mockUsers[0].details.mail);
			expect((<StarkUser>result).referenceNumber).toBe(mockUsers[0].details.referenceNumber);
			expect((<StarkUser>result).custom).toEqual(mockUsers[0].custom);

			expect(mockObserver.error).not.toHaveBeenCalled();
			expect(mockObserver.complete).toHaveBeenCalledTimes(1); // it completes because of the Store mock observable
		});
	});

	describe("getAllUsers", () => {
		it("should return the users from the mock data and then dispatch the success action", () => {
			userService["userProfiles"] = mockUserInstances;

			const result: StarkUser[] = userService.getAllUsers();

			expect(result.length).toBe(2);

			result.forEach((userInstance: StarkUser, index: number) => {
				expect(userInstance instanceof StarkUser).toBe(true);
				expect(userInstance.uuid).toBe(mockUsers[index].uuid);
				expect(userInstance.firstName).toBe(mockUsers[index].details.firstName);
				expect(userInstance.lastName).toBe(mockUsers[index].details.lastName);
				expect(userInstance.language).toBe(mockUsers[index].details.language);
				expect(userInstance.email).toBe(mockUsers[index].details.mail);
				expect(userInstance.referenceNumber).toBe(mockUsers[index].details.referenceNumber);
				expect(userInstance.custom).toEqual(mockUsers[index].custom);
			});

			expect(mockStore.dispatch).toHaveBeenCalledTimes(2);

			expect((<Spy>mockStore.dispatch).calls.argsFor(0)[0]).toEqual(new GetAllUsers());
			expect((<Spy>mockStore.dispatch).calls.argsFor(1)[0]).toEqual(new GetAllUsersSuccess(result));
		});

		it("should dispatch the failure action in case the mock data has no users defined", () => {
			userService["userProfiles"] = [];

			const result: StarkUser[] = userService.getAllUsers();

			expect(result).toEqual([]);

			expect(mockStore.dispatch).toHaveBeenCalledTimes(2);

			expect((<Spy>mockStore.dispatch).calls.argsFor(0)[0]).toEqual(new GetAllUsers());
			expect((<GetAllUsersFailure>(<Spy>mockStore.dispatch).calls.argsFor(1)[0]).type).toBe(
				StarkUserActionTypes.GET_ALL_USERS_FAILURE
			);
			expect((<GetAllUsersFailure>(<Spy>mockStore.dispatch).calls.argsFor(1)[0]).message).toContain("No user profiles found");
		});

		it("should throw an error in case any of the users defined in the mock data is not valid", () => {
			mockUserInstances[0].username = <any>undefined;
			mockUserInstances[1].firstName = <any>undefined;

			userService["userProfiles"] = mockUserInstances;

			expect(() => userService.getAllUsers()).toThrowError(/incorrect/);

			expect(mockStore.dispatch).toHaveBeenCalledTimes(1);

			expect((<Spy>mockStore.dispatch).calls.argsFor(0)[0]).toEqual(new GetAllUsers());
		});
	});

	describe("fetchUserProfile", () => {
		it("on SUCCESS, should call userRepository and then dispatch the success action and call the login() method of SessionService", () => {
			const mockResponseWrapper: StarkSingleItemResponseWrapper<StarkUser> = new StarkSingleItemResponseWrapperImpl(
				StarkHttpStatusCodes.HTTP_200_OK,
				new Map<string, string>(),
				mockUserInstances[0]
			);

			(<Spy>mockUserRepository.getUser).and.returnValue(of(mockResponseWrapper));

			userService.fetchUserProfile().subscribe(mockObserver);

			expect(mockObserver.next).toHaveBeenCalledTimes(1);
			const result: StarkUser = (<Spy>mockObserver.next).calls.argsFor(0)[0];
			expect(result).toBeDefined();
			expect(result instanceof StarkUser).toBe(true);
			expect(result.uuid).toBe(mockUsers[0].uuid);
			expect(result.firstName).toBe(mockUsers[0].details.firstName);
			expect(result.lastName).toBe(mockUsers[0].details.lastName);
			expect(result.language).toBe(mockUsers[0].details.language);
			expect(result.email).toBe(mockUsers[0].details.mail);
			expect(result.referenceNumber).toBe(mockUsers[0].details.referenceNumber);
			expect(result.custom).toEqual(mockUsers[0].custom);

			expect(mockObserver.error).not.toHaveBeenCalled();
			expect(mockObserver.complete).toHaveBeenCalledTimes(1); // it completes because of the Store mock observable

			expect(mockUserRepository.getUser).toHaveBeenCalledTimes(1);

			expect(mockStore.dispatch).toHaveBeenCalledTimes(2);

			expect((<Spy>mockStore.dispatch).calls.argsFor(0)[0]).toEqual(new FetchUserProfile());
			expect((<Spy>mockStore.dispatch).calls.argsFor(1)[0]).toEqual(new FetchUserProfileSuccess(mockUserInstances[0]));

			expect(mockSessionService.login).toHaveBeenCalledTimes(1);
			expect(mockSessionService.login).toHaveBeenCalledWith(mockUserInstances[0]);
		});

		it("on SUCCESS, should throw an error in case the user profile fetched is not valid and then dispatch the failure action", () => {
			mockUserInstances[0].username = <any>undefined;

			const mockResponseWrapper: StarkSingleItemResponseWrapper<StarkUser> = new StarkSingleItemResponseWrapperImpl(
				StarkHttpStatusCodes.HTTP_200_OK,
				new Map<string, string>(),
				mockUserInstances[0]
			);

			(<Spy>mockUserRepository.getUser).and.returnValue(of(mockResponseWrapper));

			userService.fetchUserProfile().subscribe(mockObserver);

			expect(mockObserver.next).not.toHaveBeenCalled();
			expect(mockObserver.error).toHaveBeenCalledTimes(1);
			expect(mockObserver.complete).not.toHaveBeenCalled();

			const error: Error = (<Spy>mockObserver.error).calls.argsFor(0)[0];
			expect(error.message).toContain("User defined is incorrect");

			expect(mockUserRepository.getUser).toHaveBeenCalledTimes(1);

			expect(mockStore.dispatch).toHaveBeenCalledTimes(2);

			expect((<Spy>mockStore.dispatch).calls.argsFor(0)[0]).toEqual(new FetchUserProfile());
			expect((<FetchUserProfileFailure>(<Spy>mockStore.dispatch).calls.argsFor(1)[0]).type).toBe(
				StarkUserActionTypes.FETCH_USER_PROFILE_FAILURE
			);
			expect((<Error>(<FetchUserProfileFailure>(<Spy>mockStore.dispatch).calls.argsFor(1)[0]).error).message).toContain(
				"User defined is incorrect"
			);

			expect(mockSessionService.login).not.toHaveBeenCalled();
		});

		it("on FAILURE, should call userRepository and then dispatch the failure action", () => {
			const dummyError: Error = new Error("dummy error message");

			const mockHttpError: StarkHttpError = new StarkHttpErrorImpl(dummyError);
			mockHttpError.type = "some type";
			mockHttpError.title = "a title";
			mockHttpError.titleKey = "a key";
			mockHttpError.errors = [];

			const mockHttpErrorResponse: HttpErrorResponse = new HttpErrorResponse({
				error: mockHttpError,
				status: StarkHttpStatusCodes.HTTP_404_NOT_FOUND
			});

			const mockErrorResponseWrapper: StarkHttpErrorWrapper = new StarkHttpErrorWrapperImpl(
				mockHttpErrorResponse,
				new Map<string, string>(),
				dummyError
			);

			(<Spy>mockUserRepository.getUser).and.returnValue(observableThrow(mockErrorResponseWrapper));

			userService.fetchUserProfile().subscribe(mockObserver);

			expect(mockObserver.next).not.toHaveBeenCalled();
			expect(mockObserver.error).toHaveBeenCalledTimes(1);
			expect(mockObserver.complete).not.toHaveBeenCalled();

			const errorWrapper: StarkHttpErrorWrapper = (<Spy>mockObserver.error).calls.argsFor(0)[0];

			expect(errorWrapper).toBeDefined();
			expect(errorWrapper.httpError.type).toBe(mockHttpError.type);
			expect(errorWrapper.httpError.title).toBe(mockHttpError.title);
			expect(errorWrapper.httpError.titleKey).toBe(mockHttpError.titleKey);
			expect(errorWrapper.httpError.errors.length).toBe(mockHttpError.errors.length);
			expect(mockUserRepository.getUser).toHaveBeenCalledTimes(1);

			expect(mockStore.dispatch).toHaveBeenCalledTimes(2);

			expect((<Spy>mockStore.dispatch).calls.argsFor(0)[0]).toEqual(new FetchUserProfile());
			expect((<Spy>mockStore.dispatch).calls.argsFor(1)[0]).toEqual(new FetchUserProfileFailure(mockErrorResponseWrapper));
		});
	});

	describe("setUser", () => {
		it("should dispatch the setUser action and call the login() method of SessionService", () => {
			userService.setUser(mockUserInstances[0]);

			expect(mockStore.dispatch).toHaveBeenCalledTimes(1);
			expect(mockStore.dispatch).toHaveBeenCalledWith(new SetUser(mockUserInstances[0]));

			expect(mockSessionService.login).toHaveBeenCalledTimes(1);
			expect(mockSessionService.login).toHaveBeenCalledWith(mockUserInstances[0]);
		});
	});
});
