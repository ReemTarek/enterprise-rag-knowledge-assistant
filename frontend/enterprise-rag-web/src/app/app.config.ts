import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { TitleStrategy, provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { routes } from './app.routes';
import { authInterceptor } from './core/auth/auth.interceptor';
import { AuthService } from './core/auth/auth.service';
import { provideI18n } from './core/i18n/i18n.providers';
import { AppTitleStrategy } from './core/navigation/app-title.strategy';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    { provide: TitleStrategy, useClass: AppTitleStrategy },
    provideHttpClient(withInterceptors([authInterceptor])),
    provideI18n(),
    // Restore the session from the refresh cookie before the first navigation. restoreSession never errors and has
    // its own 5 s timeout, so a dead API cannot block start-up; false just means "signed out".
    provideAppInitializer(() => firstValueFrom(inject(AuthService).restoreSession())),
  ],
};
