const Conf = require('conf')

const config = new Conf({
  projectName: 'topify-cli',
  schema: {
    apiKey: { type: 'string', default: '' },
    defaultProject: { type: 'string', default: '' },
  },
})

function getApiKey() {
  return process.env.TOPIFY_API_KEY || config.get('apiKey')
}

function setApiKey(key) {
  config.set('apiKey', key)
}

function getDefaultProject() {
  return config.get('defaultProject')
}

function setDefaultProject(projectId) {
  config.set('defaultProject', projectId)
}

function clearConfig() {
  config.clear()
}

module.exports = { getApiKey, setApiKey, getDefaultProject, setDefaultProject, clearConfig }
