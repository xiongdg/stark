"use strict";

import { Action, Store } from "@ngrx/store";
import { Observable } from "rxjs/Observable";
import { fromPromise } from "rxjs/observable/fromPromise";
import { empty } from "rxjs/observable/empty";
import { Inject, Injectable } from "@angular/core";

import { StarkLoggingService, starkLoggingServiceName } from "../../logging/services/index";
import { StarkRoutingService, starkRoutingServiceName } from "./routing.service.intf";
import {
	Navigate,
	NavigateFailure,
	NavigateRejection,
	NavigateSuccess,
	NavigationHistoryLimitReached,
	Reload,
	ReloadSuccess,
	ReloadFailure
} from "../actions/index";
import { StarkApplicationConfig, STARK_APP_CONFIG } from "../../configuration/entities/index";
import { StarkRoutingTransitionHook } from "./routing-transition-hook.constants";
import { StarkStateConfigWithParams } from "./state-config-with-params.intf";
import { StarkCoreApplicationState } from "../../common/store/index";
import {
	HookFn,
	HookMatchCriteria,
	HookRegOptions,
	HookResult,
	Param,
	PathNode,
	RawParams,
	Rejection,
	RejectType,
	Resolvable,
	StateDeclaration,
	StateObject,
	StateParams,
	StateService,
	TargetState,
	Transition,
	TransitionHookFn,
	TransitionOptions,
	TransitionService,
	TransitionStateHookFn
} from "@uirouter/core";
const _isEmpty: Function = require("lodash/isEmpty");

interface StarkState {
	name: string;
	params: RawParams | undefined;
}

/**
 * @ngdoc service
 * @name stark-core.service:StarkRoutingService
 * @description Service that can be used to interact with the router implementation.
 *
 * @requires StarkLoggingService
 * @requires ngrx-store.Store
 * @requires StarkApplicationConfig
 * @requires $state
 * @requires $transitions
 */
@Injectable()
export class StarkRoutingServiceImpl implements StarkRoutingService {
	public lastTransition: Transition;
	public knownRejectionCausesRegex: RegExp;
	public knownRejectionCauses: string[];

	// To store the state history
	/** @internal */
	private _starkStateHistory: StarkState[];

	public constructor(
		@Inject(starkLoggingServiceName) private logger: StarkLoggingService,
		private store: Store<StarkCoreApplicationState>,
		@Inject(STARK_APP_CONFIG) private appConfig: StarkApplicationConfig,
		@Inject("$state") private $state: StateService,
		@Inject("$transitions") private $transitions: TransitionService
	) {
		this.appConfig = appConfig;

		this.knownRejectionCauses = [];
		this.knownRejectionCausesRegex = new RegExp(starkRoutingServiceName + ": initial value");
		this._starkStateHistory = [];

		this.addNavigationSuccessHandlers();
		this.addNavigationErrorHandlers();

		this.logger.debug(starkRoutingServiceName + " loaded");
	}

	public navigateTo(newState: string, params?: RawParams, options?: TransitionOptions): Observable<any> {
		this.store.dispatch(new Navigate(this.getCurrentStateName(), newState, params, options));
		const transitionObservable: Observable<any> = fromPromise(this.$state.go(newState, params, options));
		return transitionObservable;
	}

	public navigateToHome(params?: RawParams): Observable<any> {
		return this.navigateTo(this.appConfig.homeStateName, params);
	}

	public navigateToPrevious(): Observable<any> {
		const reason: string = "There is no previous state to navigate to.";

		if (this._starkStateHistory.length > 1) {
			const previousState: StarkState = this._starkStateHistory[this._starkStateHistory.length - 2];
			this._starkStateHistory = this._starkStateHistory.slice(0, this._starkStateHistory.length - 2);

			if (
				(this._starkStateHistory.length === 1 && this._starkStateHistory[0].name.match(/(starkAppInit|starkAppExit)/)) ||
				this._starkStateHistory.length === 0
			) {
				this.store.dispatch(new NavigationHistoryLimitReached());
			}

			if (previousState && !previousState.name.match(/(starkAppInit|starkAppExit)/) && previousState.name !== "") {
				return this.navigateTo(previousState.name, previousState.params);
			}
		}

		this.store.dispatch(new NavigationHistoryLimitReached());
		this.logger.warn(starkRoutingServiceName + ": navigateToPrevious - " + reason);
		return empty();
	}

	public reload(): Observable<any> {
		this.store.dispatch(new Reload(this.getCurrentStateName()));
		const reload$: Observable<any> = fromPromise(this.$state.reload());
		// dispatch corresponding success action when transition is completed
		reload$.subscribe(
			() => this.store.dispatch(new ReloadSuccess(this.getCurrentStateName(), this.getCurrentStateParams())),
			() => this.store.dispatch(new ReloadFailure(this.getCurrentStateName(), this.getCurrentStateParams()))
		);
		return reload$;
	}

	public getCurrentStateName(): string {
		return <string>this.$state.current.name;
	}

	public getCurrentState(): StateObject {
		return this.$state.$current;
	}

	public getCurrentStateConfig(): StateDeclaration {
		return this.$state.current;
	}

	public getStatesConfig(): StateDeclaration[] {
		return this.$state.get();
	}

	public getStateConfigByUrlPath(urlPath: string): StarkStateConfigWithParams | undefined {
		let targetRoute: StarkStateConfigWithParams | undefined;

		const matchedState: StateDeclaration[] = this.getStatesConfig().filter((state: StateDeclaration) => {
			return (<Function>state.$$state)().url && (<Function>state.$$state)().url.exec(urlPath);
		});

		if (matchedState.length) {
			targetRoute = {
				state: matchedState[0],
				paramValues: (<Function>matchedState[0].$$state)().url.exec(urlPath)
			};
		}

		return targetRoute;
	}

	public getStateDeclarationByStateName(stateName: string): StateDeclaration | undefined {
		const stateDeclaration: StateDeclaration = this.$state.get(stateName);

		if (stateDeclaration) {
			return stateDeclaration;
		}

		return undefined;
	}

	public getCurrentStateParams(includeInherited?: boolean): RawParams {
		// TODO: This function has unexpected behaviour in some cases
		// for instance:
		//   navigateTo: homepage with params { RequestID: "Request01" }
		//   navigateTo: page-01 with params { RequestID: "Request02" }
		//   navigateTo: page-01-01 with params { RequestID: "Request03" }
		//   navigateTo: homepage with params undefined
		//
		//   getCurrentStateParams returns homepage with params { RequestID: "Request03" }

		const currentParams: StateParams = this.$state.params;
		const currentStateParams: RawParams = {};
		const stateParams: Param[] = this.$state.$current.parameters({ inherit: includeInherited });

		// extract the values from the stateOwnParams (no other way to do this :S)
		for (const param of stateParams) {
			// filter out root state default param "#"
			if (param.id !== "#") {
				currentStateParams[param.id] = currentParams[param.id];
			}
		}

		return currentStateParams;
	}

	public isCurrentUiState(stateName: string, stateParams?: RawParams): boolean {
		if (stateName === this.getCurrentStateName() && stateParams) {
			const currentStateParams: RawParams = this.getCurrentStateParams();
			let stateParamsMatchCurrent: boolean = true;

			// If there is a value in the stateParams that is different from the currentStateParams, then it is not the current state
			for (const key in stateParams) {
				if (stateParams.hasOwnProperty(key) && currentStateParams.hasOwnProperty(key)) {
					if (stateParams[key] !== currentStateParams[key]) {
						stateParamsMatchCurrent = false;
						break;
					}
				}
			}

			return stateParamsMatchCurrent;
		}

		return stateName === this.getCurrentStateName();
	}

	public addKnownNavigationRejectionCause(rejectionCause: string): void {
		this.knownRejectionCauses.push(rejectionCause);
		this.knownRejectionCausesRegex = new RegExp(this.knownRejectionCauses.join("|"));
	}

	public addTransitionHook(
		lifecycleHook: string,
		matchCriteria: HookMatchCriteria,
		callback: HookFn,
		options?: HookRegOptions
	): Function {
		switch (lifecycleHook) {
			case StarkRoutingTransitionHook.ON_BEFORE:
				// see: https://ui-router.github.io/ng1/docs/latest/classes/transition.transitionservice.html#onbefore
				return this.$transitions.onBefore(matchCriteria, <TransitionHookFn>callback, options);
			case StarkRoutingTransitionHook.ON_START:
				// see https://ui-router.github.io/ng1/docs/latest/classes/transition.transitionservice.html#onstart
				return this.$transitions.onStart(matchCriteria, <TransitionHookFn>callback, options);
			case StarkRoutingTransitionHook.ON_EXIT:
				// see: https://ui-router.github.io/ng1/docs/latest/classes/transition.transitionservice.html#onexit
				return this.$transitions.onExit(matchCriteria, <TransitionStateHookFn>callback, options);
			case StarkRoutingTransitionHook.ON_RETAIN:
				// see: https://ui-router.github.io/ng1/docs/latest/classes/transition.transitionservice.html#onretain
				return this.$transitions.onRetain(matchCriteria, <TransitionStateHookFn>callback, options);
			case StarkRoutingTransitionHook.ON_ENTER:
				// see: https://ui-router.github.io/ng1/docs/latest/classes/transition.transitionservice.html#onenter
				return this.$transitions.onEnter(matchCriteria, <TransitionStateHookFn>callback, options);
			case StarkRoutingTransitionHook.ON_FINISH:
				// see: https://ui-router.github.io/ng1/docs/latest/classes/transition.transitionservice.html#onfinish
				return this.$transitions.onFinish(matchCriteria, <TransitionHookFn>callback, options);
			case StarkRoutingTransitionHook.ON_SUCCESS:
				// see: https://ui-router.github.io/ng1/docs/latest/classes/transition.transitionservice.html#onsuccess
				return this.$transitions.onSuccess(matchCriteria, <TransitionHookFn>callback, options);
			case StarkRoutingTransitionHook.ON_ERROR:
				// see: https://ui-router.github.io/ng1/docs/latest/classes/transition.transitionservice.html#onerror
				return this.$transitions.onError(matchCriteria, <TransitionHookFn>callback, options);
			default:
				throw new Error(starkRoutingServiceName + ": lifecycle hook unknown => " + lifecycleHook);
		}
	}

	/**
	 * Adds Angular UI-Router specific handlers for errors..
	 * It logs an error and dispatches a NAVIGATE_FAILURE action to the NGRX Store
	 */
	private addNavigationErrorHandlers(): void {
		this.logger.debug(starkRoutingServiceName + ": adding navigation error handlers");

		const hookMatchCriteria: HookMatchCriteria = {
			/* empty criteria */
		};

		// Whenever an error occurs during a router transition
		this.addTransitionHook(
			StarkRoutingTransitionHook.ON_ERROR,
			hookMatchCriteria,
			(transition: Transition): HookResult => {
				const fromState: StateDeclaration = transition.from();
				const targetState: TargetState = transition.targetState();
				const rejection: Rejection = transition.error();
				const rejectionString: string = rejection.toString();
				let message: string = starkRoutingServiceName + ": ";

				if (this.knownRejectionCausesRegex.test(rejectionString)) {
					const rejectionAction: Action = new NavigateRejection(
						<string>fromState.name,
						targetState.name().toString(),
						targetState.params(),
						rejectionString
					);
					message += 'Route transition rejected: "';
					message += targetState.name() + '" navigated from "' + fromState.name + '"';
					message += ". Parameters that were passed: " + JSON.stringify(targetState.params()) + " Rejection: " + rejectionString;

					// dispatch corresponding action to allow the user to trigger his own effects if needed
					this.store.dispatch(rejectionAction);
					this.logger.warn(message);
				} else {
					switch (rejection.type) {
						case RejectType.IGNORED:
							message += 'Route transition ignored: "';
							message += targetState.name() + '" navigated from "' + fromState.name + '"';
							message +=
								". Parameters that were passed: " + JSON.stringify(targetState.params()) + " Rejection: " + rejectionString;

							this.logger.warn(message);
							break;
						case RejectType.SUPERSEDED:
							message += 'Route transition superseded: "';
							message += targetState.name() + '" navigated from "' + fromState.name + '"';
							message +=
								". Parameters that were passed: " + JSON.stringify(targetState.params()) + " Rejection: " + rejectionString;

							this.logger.warn(message);
							break;
						default:
							const failureAction: Action = new NavigateFailure(
								<string>fromState.name,
								targetState.name().toString(),
								targetState.params(),
								rejectionString
							);

							// dispatch corresponding action to allow the user to trigger his own effects if needed
							this.store.dispatch(failureAction);

							// reference: https://ui-router.github.io/docs/latest/classes/state.stateservice.html#go
							if (rejectionString.match(/transition superseded|transition prevented|transition aborted|transition failed/)) {
								this.logger.warn(starkRoutingServiceName + ": " + rejectionString);
							} else if (rejectionString.match(/resolve error/)) {
								this.logger.error(
									starkRoutingServiceName + ": An error occurred with a resolve in the new state. " + rejectionString
								);
							} else {
								message += 'Error during route transition: "';
								message += targetState.name() + '" navigated from "' + fromState.name + '"';
								message += ". Parameters that were passed: " + JSON.stringify(targetState.params());
								this.logger.error(message, transition.error());
							}

							break;
					}
				}

				// HookResult: https://ui-router.github.io/docs/latest/modules/transition.html#hookresult
				// boolean | TargetState | void | Promise<boolean | TargetState | void>
				return false;
			},
			{ priority: 1000 } // very high priority (this hook should be the first one to be called to dispatch actions immediately)
		);

		// declare the onInvalid handler
		// https://ui-router.github.io/ng1/docs/latest/classes/state.stateservice.html#oninvalid
		this.$state.onInvalid((toState?: TargetState, fromState?: TargetState): HookResult => {
			const errorType: string = "Invalid state change";
			const failureAction: Action = new NavigateFailure(
				(<TargetState>fromState).name(),
				(<TargetState>toState).name(),
				(<TargetState>toState).params(),
				errorType
			);
			let message: string =
				starkRoutingServiceName + ': Error while trying to navigate from "' + (<TargetState>fromState).name() + '"';
			message += ' to "' + (<TargetState>toState).name() + '"';

			if (toState && !toState.exists()) {
				message = message + ". The target state does NOT exist";
			}

			// dispatch corresponding action to allow the user to trigger his own effects if needed
			this.store.dispatch(failureAction);
			this.logger.error(message, new Error("Parameters that were passed: " + JSON.stringify((<TargetState>toState).params())));

			// TODO redirect to the generic error page once implemented: https://jira.prd.nbb/browse/NG-847
			// should probably be done via an effect reacting to the StarkRoutingActions.navigateFailure action

			// HookResult: https://ui-router.github.io/docs/latest/modules/transition.html#hookresult
			// boolean | TargetState | void | Promise<boolean | TargetState | void>
			return false;
		});

		// provide custom default error handler
		// https://ui-router.github.io/ng1/docs/latest/classes/state.stateservice.html#defaulterrorhandler
		this.$state.defaultErrorHandler((error: any): void => {
			if (!this.knownRejectionCausesRegex.test(String(error))) {
				this.logger.error(starkRoutingServiceName + ": defaultErrorHandler => ", error);
			}
		});
	}

	/**
	 * Adds Angular UI-Router specific handlers for success..
	 * It stores the last transition
	 */
	private addNavigationSuccessHandlers(): void {
		this.logger.debug(starkRoutingServiceName + ": adding navigation success handlers");

		const hookMatchCriteria: HookMatchCriteria = {
			/* empty criteria */
		};

		// Whenever a router transition successfully completes
		this.addTransitionHook(
			StarkRoutingTransitionHook.ON_SUCCESS,
			hookMatchCriteria,
			(transition: Transition): HookResult => {
				this.lastTransition = transition;
				// HookResult: https://ui-router.github.io/docs/latest/modules/transition.html#hookresult
				// boolean | TargetState | void | Promise<boolean | TargetState | void>

				const previousStateName: string = <string>transition.from().name;
				const currentState: TargetState = transition.targetState();

				this.store.dispatch(new NavigateSuccess(previousStateName, currentState.name(), currentState.params()));

				// Add the params of the current state to the _stateTreeParams array
				this._starkStateHistory.push({ name: currentState.name(), params: currentState.params() });

				return true; // the transition will resume
			},
			{ priority: 1000 } // very high priority (this hook should be the first one to be called to keep the lastTransition up to date)
		);
	}

	public getStateTreeParams(): Map<string, any> {
		const stateTreeParams: Map<string, any> = new Map<string, any>();

		// we use the TO pathNodes because the resolved values can only be found in those and not in the FROM pathNodes
		const pathNodes: PathNode[] = this.lastTransition.treeChanges().to;

		// the array is processed in reverse to start with the child state first (the pathNodesArray is [rootState, ..., childState])
		let index: number = pathNodes.length - 1;

		for (index; index >= 0; index--) {
			const pathNode: PathNode = pathNodes[index];

			// skipping abstract states and the root state
			if (!pathNode.state.abstract && pathNode.state !== pathNode.state.root()) {
				let stateParams: RawParams | undefined;

				for (let i: number = this._starkStateHistory.length - 1; i >= 0; i--) {
					if (this._starkStateHistory[i].name === pathNode.state.name) {
						stateParams = this._starkStateHistory[i].params;
						break;
					}
				}

				stateTreeParams.set(pathNode.state.name, stateParams);
			}
		}

		return stateTreeParams;
	}

	public getStateTreeResolves(): Map<string, any> {
		const stateTreeResolves: Map<string, any> = new Map<string, any>();

		// we use the TO pathNodes because the resolved values can only be found in those and not in the FROM pathNodes
		const pathNodes: PathNode[] = this.lastTransition.treeChanges().to;

		// the array is processed in reverse to start with the child state first (the pathNodesArray is [rootState, ..., childState])
		let index: number = pathNodes.length - 1;

		for (index; index >= 0; index--) {
			const pathNode: PathNode = pathNodes[index];

			// skipping abstract states and the root state
			if (!pathNode.state.abstract && pathNode.state !== pathNode.state.root()) {
				// taking only the current state and parent/ancestor states
				if (pathNode.state === this.getCurrentState() || this.isParentState(pathNode.state)) {
					const resolvablesData: { [key: string]: any } = this.extractResolvablesData(pathNode.resolvables);
					const stateResolves: any = _isEmpty(resolvablesData) ? undefined : resolvablesData;
					stateTreeResolves.set(pathNode.state.name, stateResolves);
				}
			}
		}

		return stateTreeResolves;
	}

	public getStateTreeData(): Map<string, any> {
		const stateTreeData: Map<string, any> = new Map<string, any>();

		// we use the TO pathNodes to get also the current state (the FROM pathNodes include only the previous/parent states)
		const pathNodes: PathNode[] = this.lastTransition.treeChanges().to;

		// the array is processed in reverse to start with the child state first (the pathNodesArray is [rootState, ..., childState])
		let index: number = pathNodes.length - 1;

		for (index; index >= 0; index--) {
			const pathNode: PathNode = pathNodes[index];

			// skipping abstract states and the root state
			if (!pathNode.state.abstract && pathNode.state !== pathNode.state.root()) {
				// taking only the current state and parent/ancestor states
				if (pathNode.state === this.getCurrentState() || this.isParentState(pathNode.state)) {
					const stateData: any = _isEmpty(pathNode.state.data) ? undefined : pathNode.state.data;
					stateTreeData.set(pathNode.state.name, stateData);
				}
			}
		}

		return stateTreeData;
	}

	/**
	 * Check whether the given state is a parent/ancestor of the given currentState
	 * @param state - The state that will be checked whether is a parent of the currentState
	 * @param currentState - (Optional) If not provided, it is set to the current router state
	 */
	private isParentState(state: StateObject, currentState: StateObject = this.getCurrentState()): boolean {
		if (currentState.parent) {
			if (currentState.parent === state) {
				return true;
			} else {
				return this.isParentState(state, currentState.parent);
			}
		} else {
			return false;
		}
	}

	private extractResolvablesData(resolvables: Resolvable[]): { [key: string]: any } {
		const resolvablesData: { [key: string]: any } = {};

		for (const resolvable of resolvables) {
			// exclude the 'Core Resolvables' added by angular-ui-router
			// see: https://github.com/ui-router/core/commit/a06948b
			if (resolvable.token !== "$state$" && resolvable.token !== "$transition$" && resolvable.token !== "$stateParams") {
				resolvablesData[resolvable.token] = resolvable.data;
			}
		}

		return resolvablesData;
	}

	public getTranslationKeyFromState(stateName: string): string {
		const stateTreeResolves: Map<string, any> = this.getStateTreeResolves();
		const stateTreeData: Map<string, any> = this.getStateTreeData();

		let stateTranslationKey: string | undefined;
		// get the translationKey in case it is defined as a resolve in the state definition
		if (stateTreeResolves.get(stateName)) {
			stateTranslationKey = stateTreeResolves.get(stateName)["translationKey"];
		}
		// if not found in the resolves then check the state's data object
		if (!stateTranslationKey && stateTreeData.get(stateName)) {
			stateTranslationKey = stateTreeData.get(stateName)["translationKey"];
		}
		// if no translationKey so far, then the state name is used
		if (!stateTranslationKey) {
			this.logger.warn(starkRoutingServiceName + ": translation key not found for state " + stateName);
			stateTranslationKey = stateName;
		}

		return stateTranslationKey;
	}
}
