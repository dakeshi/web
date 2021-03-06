import { put, select, takeLatest } from 'redux-saga/effects';
import update from 'immutability-helper';
import { setToken, removeToken } from 'utils/token';
import { format } from '../utils';
import { selectAppProps } from 'features/App/selectors';
import steemConnectAPI from 'utils/steemConnectAPI';
import { getToken, getEncryptedToken } from 'utils/token';
import api from 'utils/api';

/*--------- CONSTANTS ---------*/
const GET_ME_BEGIN = 'GET_ME_BEGIN';
const REFRESH_ME_BEGIN = 'REFRESH_ME_BEGIN';
const GET_ME_SUCCESS = 'GET_ME_SUCCESS';
const GET_ME_FAILURE = 'GET_ME_FAILURE';

/*--------- ACTIONS ---------*/
export function getMeBegin(token) {
  return { type: GET_ME_BEGIN, token };
}

export function refreshMeBegin() {
  return { type: REFRESH_ME_BEGIN };
}

export function getMeSuccess(me) {
  return { type: GET_ME_SUCCESS, me };
}

export function getMeFailure(message) {
  return { type: GET_ME_FAILURE, message };
}

/*--------- REDUCER ---------*/
export function getMeReducer(state, action) {
  switch (action.type) {
    case GET_ME_BEGIN: {
      return update(state, {
        isLoading: { $set: true },
      });
    }
    case GET_ME_SUCCESS: {
      const { account, user } = action.me;
      return update(state, {
        isLoading: { $set: false },
        me: { $set: user },
        accounts: {
          [user]: {$auto: { $merge: account }},
        },
      });
    }
    case GET_ME_FAILURE: {
      return update(state, {
        isLoading: { $set: false },
      });
    }
    default:
      return state;
  }
}

/*--------- SAGAS ---------*/
function* getMe({ token }) {
  try {
    token = token || getToken();
    if (!token) {
      yield put(getMeFailure('Not logged in'));
      return;
    }
    steemConnectAPI.setAccessToken(token);

    const me = yield steemConnectAPI.me();
    const appProps = yield select(selectAppProps());

    setToken(token);
    yield api.post('/users.json', { user: { username: me.account.name, encrypted_token: getEncryptedToken() } });

    yield put(getMeSuccess({
      ...me,
      account: format(me.account, appProps),
    }));
  } catch(e) {
    removeToken();
    console.error(e);
    yield put(getMeFailure(e.message));
  }
}

export function* getMeManager() {
  yield takeLatest(GET_ME_BEGIN, getMe);
}

function* refreshMe() {
  try {
    const me = yield steemConnectAPI.me();
    const appProps = yield select(selectAppProps());

    yield put(getMeSuccess({
      ...me,
      account: format(me.account, appProps),
    }));
  } catch(e) {
    console.error(e);
  }
}

export function* refreshMeManager() {
  yield takeLatest(REFRESH_ME_BEGIN, refreshMe);
}