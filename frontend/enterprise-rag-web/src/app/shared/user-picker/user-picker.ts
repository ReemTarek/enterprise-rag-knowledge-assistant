import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import {
  MatAutocompleteModule,
  MatAutocompleteSelectedEvent,
} from '@angular/material/autocomplete';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { TranslocoPipe } from '@jsverse/transloco';
import { Observable, catchError, filter, map, of, switchMap, tap, timer } from 'rxjs';
import { DirectoryUser } from './directory-user';

type SearchOutcome =
  { kind: 'idle' } | { kind: 'results'; users: DirectoryUser[] } | { kind: 'error' };

export const USER_SEARCH_DEBOUNCE_MS = 300;
export const USER_SEARCH_MIN_CHARS = 2;
export const USER_SEARCH_MAX_CHARS = 100;

/**
 * Debounced directory search (300 ms, 2-100 chars). Emits the chosen user, or null as soon as the text is edited
 * again so a stale selection can never be submitted.
 */
@Component({
  selector: 'app-user-picker',
  imports: [
    ReactiveFormsModule,
    MatAutocompleteModule,
    MatFormFieldModule,
    MatInputModule,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mat-form-field class="field">
      <mat-label>{{ 'userPicker.label' | transloco }}</mat-label>
      <input
        matInput
        type="text"
        dir="auto"
        autocomplete="off"
        data-testid="user-picker-input"
        [formControl]="text"
        [matAutocomplete]="auto"
      />
      <mat-hint>{{ 'userPicker.hint' | transloco }}</mat-hint>
    </mat-form-field>
    <mat-autocomplete
      #auto="matAutocomplete"
      [displayWith]="display"
      (optionSelected)="onSelected($event)"
    >
      @for (u of visible(); track u.id) {
        <mat-option [value]="u">
          <bdi>{{ u.displayName }}</bdi>&ngsp;<bdi class="email" dir="ltr">{{ u.email }}</bdi>
        </mat-option>
      }
    </mat-autocomplete>
    <p class="status" role="status" aria-live="polite">
      @if (error()) {
        {{ 'userPicker.error' | transloco }}
      } @else if (searched() && visible().length === 0) {
        {{ 'userPicker.none' | transloco }}
      }
    </p>
  `,
  styles: `
    :host {
      display: block;
    }
    .field {
      inline-size: 100%;
    }
    .email {
      color: var(--mat-sys-on-surface-variant);
    }
    .status {
      margin-block: 0;
      min-block-size: 1em;
      font: var(--mat-sys-body-small);
    }
  `,
})
export class UserPicker {
  /** Directory lookup, injected by the host so this component stays feature-agnostic. */
  readonly search = input.required<(query: string) => Observable<DirectoryUser[]>>();
  /** Users to hide from the results (e.g. existing members). */
  readonly excludeIds = input<readonly string[]>([]);
  readonly selected = output<DirectoryUser | null>();

  protected readonly text = new FormControl<string | DirectoryUser>('', { nonNullable: true });
  private readonly results = signal<DirectoryUser[]>([]);
  protected readonly searched = signal(false);
  /** The last search failed (network, 5xx, 429...): a translated message replaces the result hint. */
  protected readonly error = signal(false);
  protected readonly visible = computed(() => {
    const hidden = new Set(this.excludeIds());
    return this.results().filter((u) => !hidden.has(u.id));
  });
  protected readonly display = (v: DirectoryUser | string | null): string =>
    typeof v === 'string' ? v : (v?.displayName ?? '');

  constructor() {
    this.text.valueChanges
      .pipe(
        tap((v) => {
          if (typeof v === 'string') this.selected.emit(null);
        }),
        filter((v): v is string => typeof v === 'string'),
        map((v) => v.trim()),
        tap(() => this.error.set(false)),
        // switchMap first: every keystroke cancels the previous debounce window AND any request still in flight, so a
        // late answer for an older query can never repopulate the list (also not after the text got too short).
        switchMap((q): Observable<SearchOutcome> => {
          if (q.length < USER_SEARCH_MIN_CHARS || q.length > USER_SEARCH_MAX_CHARS) {
            return of({ kind: 'idle' });
          }
          return timer(USER_SEARCH_DEBOUNCE_MS).pipe(
            switchMap(() => this.search()(q)),
            map((users): SearchOutcome => ({ kind: 'results', users })),
            catchError(() => of<SearchOutcome>({ kind: 'error' })),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((outcome) => {
        this.results.set(outcome.kind === 'results' ? outcome.users : []);
        this.searched.set(outcome.kind === 'results');
        this.error.set(outcome.kind === 'error');
      });
  }

  protected onSelected(event: MatAutocompleteSelectedEvent): void {
    this.selected.emit(event.option.value as DirectoryUser);
  }

  /** Clears the text and any pending selection (used by the host after a successful add). */
  reset(): void {
    this.text.setValue('');
    this.results.set([]);
    this.searched.set(false);
    this.error.set(false);
  }
}
