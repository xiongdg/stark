import { NgModule, NgModuleFactoryLoader, SystemJsNgModuleLoader } from "@angular/core";
import { BrowserModule } from "@angular/platform-browser";
import { FormsModule } from "@angular/forms";
import { UIRouterModule } from "@uirouter/angular";
import { StoreModule, MetaReducer, ActionReducerMap, ActionReducer } from "@ngrx/store";
import { storeFreeze } from "ngrx-store-freeze";
import { storeLogger } from "ngrx-store-logger";
import { BrowserAnimationsModule } from "@angular/platform-browser/animations";
import {
	StarkHttpModule,
	StarkLoggingModule,
	STARK_APP_CONFIG,
	StarkApplicationConfig,
	StarkApplicationConfigImpl
} from "@nationalbankbelgium/stark-core";
import { routerConfigFn } from "./router.config";
import { Deserialize } from "cerialize";

/*
 * Platform and Environment providers/directives/pipes
 */
import { environment } from "../environments/environment";
import { APP_STATES } from "./app.routes";
// App is our top level component
import { AppComponent } from "./app.component";
import { AppState } from "./app.service";
import { HomeComponent } from "./home";
import { AboutComponent } from "./about";
import { NoContentComponent } from "./no-content";
import { XLargeDirective } from "./home/x-large";
import { DevModuleModule } from "./+dev-module";

/* tslint:disable:no-import-side-effect */
import "../styles/styles.scss";
/* tslint:enable */
import "../styles/headings.css";

// Application wide providers
const APP_PROVIDERS: any[] = [AppState];

// TODO: where to put this factory function?
export function starkAppConfigFactory(): StarkApplicationConfig {
	const config: any = require("../stark-app-config.json");

	const applicationConfig: StarkApplicationConfig = Deserialize(config, StarkApplicationConfigImpl);
	// FIXME: Make sure the correct values are used below
	applicationConfig.rootStateUrl = "home";
	applicationConfig.rootStateName = "";
	applicationConfig.homeStateName = "home";
	applicationConfig.errorStateName = "";
	applicationConfig.angularDebugInfoEnabled = true; //DEVELOPMENT;
	applicationConfig.debugLoggingEnabled = true; //DEVELOPMENT;
	applicationConfig.routerLoggingEnabled = true; //DEVELOPMENT;

	return applicationConfig;
}

// Application Redux State
export interface State {
	// reducer interfaces
}

export const reducers: ActionReducerMap<State> = {
	// reducers
};

export function logger(reducer: ActionReducer<State>): any {
	// default, no options
	return storeLogger()(reducer);
}

export const metaReducers: MetaReducer<State>[] = !environment.production ? [logger, storeFreeze] : [];

/**
 * `AppModule` is the main entry point into Angular2's bootstrapping process
 */
@NgModule({
	bootstrap: [AppComponent],
	declarations: [AppComponent, AboutComponent, HomeComponent, NoContentComponent, XLargeDirective],
	/**
	 * Import Angular's modules.
	 */
	imports: [
		BrowserModule,
		BrowserAnimationsModule,
		FormsModule,
		StarkHttpModule,
		StarkLoggingModule,
		StoreModule.forRoot(reducers, {
			metaReducers
		}),
		UIRouterModule.forRoot({
			states: APP_STATES,
			useHash: Boolean(history.pushState) === false,
			otherwise: { state: "otherwise" },
			config: routerConfigFn
		}),

		/**
		 * This section will import the `DevModuleModule` only in certain build types.
		 * When the module is not imported it will get tree shaked.
		 * This is a simple example, a big app should probably implement some logic
		 */
		...(environment.showDevModule ? [DevModuleModule] : [])
	],
	/**
	 * Expose our Services and Providers into Angular's dependency injection.
	 */
	providers: [
		environment.ENV_PROVIDERS,
		APP_PROVIDERS,
		{ provide: NgModuleFactoryLoader, useClass: SystemJsNgModuleLoader }, // needed for ui-router
		{ provide: STARK_APP_CONFIG, useFactory: starkAppConfigFactory }
	]
})
export class AppModule {}
