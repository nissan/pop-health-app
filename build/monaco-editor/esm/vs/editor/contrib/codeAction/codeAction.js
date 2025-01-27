/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { flatten, isNonEmptyArray, mergeSort } from '../../../base/common/arrays.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { illegalArgument, isPromiseCanceledError, onUnexpectedExternalError } from '../../../base/common/errors.js';
import { URI } from '../../../base/common/uri.js';
import { registerLanguageCommand } from '../../browser/editorExtensions.js';
import { Range } from '../../common/core/range.js';
import { CodeActionProviderRegistry } from '../../common/modes.js';
import { IModelService } from '../../common/services/modelService.js';
import { CodeActionKind, filtersAction, mayIncludeActionsOfKind } from './codeActionTrigger.js';
export function getCodeActions(model, rangeOrSelection, trigger, token) {
    var filter = trigger.filter || {};
    var codeActionContext = {
        only: filter.kind ? filter.kind.value : undefined,
        trigger: trigger.type === 'manual' ? 2 /* Manual */ : 1 /* Automatic */
    };
    var promises = getCodeActionProviders(model, filter).map(function (provider) {
        return Promise.resolve(provider.provideCodeActions(model, rangeOrSelection, codeActionContext, token)).then(function (providedCodeActions) {
            if (!Array.isArray(providedCodeActions)) {
                return [];
            }
            return providedCodeActions.filter(function (action) { return action && filtersAction(filter, action); });
        }, function (err) {
            if (isPromiseCanceledError(err)) {
                throw err;
            }
            onUnexpectedExternalError(err);
            return [];
        });
    });
    return Promise.all(promises)
        .then(flatten)
        .then(function (allCodeActions) { return mergeSort(allCodeActions, codeActionsComparator); });
}
function getCodeActionProviders(model, filter) {
    return CodeActionProviderRegistry.all(model)
        // Don't include providers that we know will not return code actions of interest
        .filter(function (provider) {
        if (!provider.providedCodeActionKinds) {
            // We don't know what type of actions this provider will return.
            return true;
        }
        return provider.providedCodeActionKinds.some(function (kind) { return mayIncludeActionsOfKind(filter, new CodeActionKind(kind)); });
    });
}
function codeActionsComparator(a, b) {
    if (isNonEmptyArray(a.diagnostics)) {
        if (isNonEmptyArray(b.diagnostics)) {
            return a.diagnostics[0].message.localeCompare(b.diagnostics[0].message);
        }
        else {
            return -1;
        }
    }
    else if (isNonEmptyArray(b.diagnostics)) {
        return 1;
    }
    else {
        return 0; // both have no diagnostics
    }
}
registerLanguageCommand('_executeCodeActionProvider', function (accessor, args) {
    var resource = args.resource, range = args.range, kind = args.kind;
    if (!(resource instanceof URI) || !Range.isIRange(range)) {
        throw illegalArgument();
    }
    var model = accessor.get(IModelService).getModel(resource);
    if (!model) {
        throw illegalArgument();
    }
    return getCodeActions(model, model.validateRange(range), { type: 'manual', filter: { includeSourceActions: true, kind: kind && kind.value ? new CodeActionKind(kind.value) : undefined } }, CancellationToken.None);
});
