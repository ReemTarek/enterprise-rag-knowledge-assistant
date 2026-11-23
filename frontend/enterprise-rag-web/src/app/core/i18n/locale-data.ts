import { registerLocaleData } from '@angular/common';
import localeAr from '@angular/common/locales/ar';
import localeDe from '@angular/common/locales/de';

// `en` ships with Angular. Registered for DatePipe, which is given the active language explicitly
// (LanguageService.current), so a language switch re-formats dates without changing LOCALE_ID or reloading.
registerLocaleData(localeAr, 'ar');
registerLocaleData(localeDe, 'de');
