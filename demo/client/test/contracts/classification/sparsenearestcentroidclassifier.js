const { convertData } = require('../../../src/float-utils-node')
const { deploySparseNearestCentroidClassifier } = require('../../../src/ml-models/deploy-model-node')

contract('SparseNearestCentroidClassifier', function (accounts) {
	const toFloat = 1E9
	let classifier

	function parseBN(num) {
		if (web3.utils.isBN(num)) {
			return num.toNumber()
		} else {
			assert.typeOf(num, 'number')
			return num
		}
	}

	function parseFloatBN(bn) {
		assert(web3.utils.isBN(bn), `${bn} is not a BN`)
		// Can't divide first since a BN can only be an integer.
		return bn.toNumber() / toFloat
	}

	before("deploy classifier", async function () {
		const model = {
			intents: {
				ALARM: {
					centroid: [+1, 0, 0],
					dataCount: 2,
				},
				WEATHER: {
					centroid: [0, +1, 0],
					dataCount: 2
				}
			}
		}
		classifier = (await deploySparseNearestCentroidClassifier(model, web3, toFloat)).classifierContract
	})

	it("...should get the classifications", function () {
		const expectedClassifications = ["ALARM", "WEATHER"]
		return classifier.getNumClassifications().then(parseBN).then(numClassifications => {
			assert.equal(numClassifications, expectedClassifications.length, "Number of classifications is wrong")
			let promises = expectedClassifications.map((_, i) => {
				return classifier.classifications(i)
			})
			return Promise.all(promises).then(results => {
				assert.deepEqual(results, expectedClassifications, "Wrong classifications")
			})
		})
	})

	it("...should get the squared magnitudes", async function () {
		const squaredMagnitude0 = await classifier.getSquaredMagnitude(0)
		let expected = web3.utils.toBN(toFloat).mul(web3.utils.toBN(toFloat))
		assert(squaredMagnitude0.eq(expected), `${squaredMagnitude0} != ${expected}`);

		const squaredMagnitude1 = await classifier.getSquaredMagnitude(1)
		expected = web3.utils.toBN(toFloat).mul(web3.utils.toBN(toFloat))
		assert(squaredMagnitude1.eq(expected), `${squaredMagnitude1} != ${expected}`);
	})

	it("...should predict the classification", async function () {
		const data = [0]
		const prediction = await classifier.predict(data)
		assert.equal(prediction, 0, "Wrong classification")
	})

	it("...should predict the classification", async function () {
		const data = [1]
		const prediction = await classifier.predict(data)
		assert.equal(prediction, 1, "Wrong classification")
	})

	it("...should train", async function () {
		const data = [1, 2]
		const classification = 1

		const promises = []
		for (let dimension = 0; dimension < 3; ++dimension) {
			promises.push(classifier.getCentroidValue(classification, dimension).then(parseFloatBN))
		}
		const originalCentroidValues = await Promise.all(promises)
		return classifier.getNumSamples(classification).then(parseBN).then(originalDataCount => {
			return classifier.update(data, classification).then(() => {
				return classifier.getNumSamples(classification).then(parseBN).then(async dataCount => {
					assert.equal(dataCount, originalDataCount + 1, "Wrong data count.")
					for (let dimension = 0; dimension < 3; ++dimension) {
						const v = await classifier.getCentroidValue(classification, dimension).then(parseFloatBN)
						const update = data.indexOf(dimension) >= 0 ? 1 : 0
						assert.closeTo(v, (originalCentroidValues[dimension] * originalDataCount + update) / dataCount, 1 / toFloat,
							`value for centroid[${dimension}]`)
					}
				})
			})
		})
	})

	it("...should add class", async function () {
		const centroid = [0, 0, +1]
		const newClassificationName = "NEW"
		const dataCount = 2

		const originalNumClassifications = await classifier.getNumClassifications().then(parseBN)
		const info = await classifier.addClass(convertData(centroid, web3, toFloat), newClassificationName, dataCount)
		const events = info.logs.filter(l => l.event == 'AddClass')
		assert.lengthOf(events, 1)
		const event = events[0]
		assert.equal(event.args.name, newClassificationName)
		const newClassificationIndex = parseBN(event.args.index)
		assert.equal(newClassificationIndex, originalNumClassifications)
		const newNumClassifications = await classifier.getNumClassifications().then(parseBN)
		assert.equal(newNumClassifications, originalNumClassifications + 1)
		const className = await classifier.classifications(newClassificationIndex)
		assert.equal(className, newClassificationName)
		const foundDataCount = await classifier.getNumSamples(newClassificationIndex).then(parseBN)
		assert.equal(foundDataCount, dataCount)
	})

	it("...should extend centroids", async function () {
		const classification = 0
		const extension = [2, 2]
		const originalCentroidValues = await Promise.all([...Array(3).keys()].map(dimension => {
			return classifier.getCentroidValue(classification, dimension).then(parseFloatBN)
		}))
		const expectedCentroidValues = Array.prototype.concat(originalCentroidValues, extension)
		await classifier.extendCentroid(convertData(extension, web3, toFloat), classification)

		for (let dimension = 0; dimension < expectedCentroidValues.length; ++dimension) {
			const v = await classifier.getCentroidValue(classification, dimension).then(parseFloatBN)
			assert.closeTo(v, expectedCentroidValues[dimension], 1 / toFloat, `value for centroid[${dimension}]`)
		}
	})
})
