import { put, select, takeLatest } from 'redux-saga/effects';
import update from 'immutability-helper';
import api from 'utils/api';
import { createPermlink } from 'utils/helpers/steemitHelpers';
import { selectMyAccount } from 'features/User/selectors';
import { selectDraft } from '../selectors';
import { notification } from 'antd';
import { getPostKey, getPostPath } from 'features/Post/utils';
import steemConnectAPI from 'utils/steemConnectAPI';
import { initialState } from '../actions';

/*--------- CONSTANTS ---------*/
const MAIN_CATEGORY = 'steemhunt';
const APP_NAME = 'steemhunt';
const DEFAULT_BENEFICIARY = { account: 'steemhunt', weight: 1000 };

const PUBLISH_CONTENT_BEGIN = 'PUBLISH_CONTENT_BEGIN';
const PUBLISH_CONTENT_SUCCESS = 'PUBLISH_CONTENT_SUCCESS';
const PUBLISH_CONTENT_FAILURE = 'PUBLISH_CONTENT_FAILURE';

/*--------- ACTIONS ---------*/

export function publishContentBegin(props, editMode) {
  return { type: PUBLISH_CONTENT_BEGIN, props, editMode };
}

export function publishContentSuccess(post) {
  return { type: PUBLISH_CONTENT_SUCCESS, post };
}

export function publishContentFailure(message) {
  return { type: PUBLISH_CONTENT_FAILURE, message };
}

/*--------- REDUCER ---------*/
export function publishContentReducer(state, action) {
  switch (action.type) {
    case PUBLISH_CONTENT_BEGIN: {
      return update(state, {
        isPublishing: { $set: true },
      });
    }
    case PUBLISH_CONTENT_SUCCESS: {
      return update(state, {
        posts: { [getPostKey(action.post)]: { $set: action.post } },
        isPublishing: { $set: false },
      });
    }
    case PUBLISH_CONTENT_FAILURE: {
      return update(state, {
        isPublishing: { $set: false },
      });
    }
    default:
      return state;
  }
}

function getBody(post) {
  const screenshots = post.images.map(i => `<center>![${i.name}](${i.link})</center>\n\n`).join('');

  let contributors = '';
  if (post.beneficiaries && post.beneficiaries.length > 0) {
    contributors = 'Makers and Contributors:\n' +
      post.beneficiaries.map(b => `- @${b.account} (${b.weight / 100}% beneficiary of this article)\n`).join('');
  }
  return `# ${post.title}\n` +
    `${post.tagline}\n` +
    `\n---\n` +
    `## Screenshots\n` +
    `${screenshots}\n` +
    `\n---\n` +
    `## Hunter's comment\n` +
    `${post.description}\n` +
    `\n---\n` +
    `## Link\n` +
    `${post.url}\n` +
    `\n---\n` +
    `## Contributors\n` +
    `Hunter: @${post.author}\n` +
    `${contributors}` +
    `\n---\n` +
    `<center>` +
    `<br/>![Steemhunt.com](https://i.imgur.com/jB2axnW.png)<br/>\n` +
    `This is posted on Steemhunt - A place where you can dig products and earn STEEM.\n` +
    `[View on Steemhunt.com](https://steemhunt.com/@${post.author}/${post.permlink})\n` +
    `</center>`;
}

/*--------- SAGAS ---------*/
function* publishContent({ props, editMode }) {
  const post = yield select(selectDraft());
  // console.log('1------', post);

  try {
    if (post.url === initialState.draft.url) {
      throw new Error("Please check errors on product link field.");
    }
    if (post.title === initialState.draft.title) {
      throw new Error("Product name can't be empty.");
    }
    if (post.tagline === initialState.draft.tagline) {
      throw new Error("Short description can't be empty.");
    }
    if (post.images.length < 1) {
      throw new Error("Please upload at least one image.");
    }

    const myAccount = yield select(selectMyAccount());
    if (myAccount.name !== post.author) {
      throw new Error("Please login before posting.");
    }

    const title = `${post.title} - ${post.tagline}`;

    if (editMode) { // Edit
      yield api.put(`/posts${getPostPath(post)}.json`, { post: post }, true);
    } else { // Create
      post.permlink = yield createPermlink(title, post.author, '', '');
      yield api.post('/posts.json', { post: post }, true);
    }
    // console.log('2------', res);

    // Inject 'steemhunt' as a main category for every post
    const tags = [MAIN_CATEGORY].concat(post.tags);

    // Prepare data
    const metadata = {
      tags: tags,
      image: post.images.map(i => i.link),
      links: [ post.url ],
      app: APP_NAME,
    };

    let operations = [
      ['comment',
        {
          parent_author: '',
          parent_permlink: tags[0],
          author: post.author,
          permlink: post.permlink,
          title,
          body: getBody(post),
          json_metadata: JSON.stringify(metadata),
        },
      ]
    ];

    if (!editMode) { // only on create
      operations.push(['comment_options', {
        author: post.author,
        permlink: post.permlink,
        max_accepted_payout: '1000000.000 SBD',
        percent_steem_dollars: 10000,
        allow_votes: true,
        allow_curation_rewards: true,
        extensions: [
          [0, {
            beneficiaries: [DEFAULT_BENEFICIARY].concat(post.beneficiaries || [])
          }]
        ]
      }]);
    }
    // console.log('3-------------', operations);

    try {
      yield steemConnectAPI.broadcast(operations);
    } catch (e) {
      // Delete post on Steemhunt as transaction failed
      yield api.delete(`/posts${getPostPath(post)}.json`, null, true);
      throw e;
    }
    yield put(publishContentSuccess(post));
    if (editMode) {
      yield notification['success']({ message: 'Your post has been successfully updated!' });
    } else {
      yield notification['success']({ message: 'Your post has been successfully published!' });
    }

    yield props.history.push(getPostPath(post)); // Redirect to #show
  } catch (e) {
    if (e.error_description) {
      if (e.error_description.indexOf('STEEMIT_MIN_ROOT_COMMENT_INTERVAL') >= 0) {
        yield notification['error']({ message: 'You may only post once every 5 minutes.' });
      } else {
        yield notification['error']({ message: e.error_description });
      }
    } else {
      yield notification['error']({ message: e.message });
    }
    yield put(publishContentFailure(e.message));
  }
}

export default function* publishContentManager() {
  yield takeLatest(PUBLISH_CONTENT_BEGIN, publishContent);
}
